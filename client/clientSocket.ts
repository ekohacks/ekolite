import { EventEmitter, OutputTracker } from '../server/infrastructure/outputTracker.ts';
import { ClientMessage, ServerMessage } from '../shared/protocol.ts';

const EVENT_OUTBOUND = 'outbound';
const EVENT_INBOUND = 'inbound';
const CLIENT_DISCONNECTION_EVENT = 'disconnection';

// The switch is mostly permissive and validates only fields we read.
// Some cases intentionally reject contradictory payload shapes.
export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }

  const msg = data as Record<string, unknown>;
  const type = msg.type;

  switch (type) {
    case 'ready':
      return typeof msg.id === 'string' && typeof msg.collection === 'string';
    case 'result':
      return typeof msg.id === 'string';
    case 'added':
    case 'changed':
      return typeof msg.collection === 'string' && typeof msg.id === 'string';
    case 'removed':
      return typeof msg.collection === 'string' && typeof msg.id === 'string' && !('fields' in msg);
    case 'error':
      return (
        typeof msg.id === 'string' &&
        typeof msg.error === 'object' &&
        msg.error !== null &&
        typeof (msg.error as Record<string, unknown>).code === 'number' &&
        typeof (msg.error as Record<string, unknown>).message === 'string'
      );
    case 'pong':
      return true;
    default:
      return false;
  }
}

interface ClientSocketOptions {
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  reconnect?: boolean;
}

export interface SocketCloseEvent {
  deliberate: boolean;
}

type HeartbeatSender = () => void;
type HeartbeatCloser = () => void;

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  readyState: number;
}

type WebSocketFactory = (url: string) => WebSocketLike;

export class Heartbeat {
  private intervalId?: ReturnType<typeof setInterval> | undefined;
  private timeoutId?: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly sendPing: HeartbeatSender,
    private readonly close: HeartbeatCloser,
    private readonly options: ClientSocketOptions,
  ) {}

  start(): void {
    const interval = this.options.pingIntervalMs ?? 0;
    if (interval <= 0) {
      return; // opt-in: unset or 0 means the heartbeat is off
    }
    this.intervalId = setInterval(() => {
      this.ping();
    }, interval);
  }

  private ping(): void {
    this.sendPing();
    const timeout = this.options.pongTimeoutMs ?? 0;
    if (timeout <= 0) {
      return; // ping only, no liveness deadline configured
    }
    // A fresh deadline per ping, cleared by onPong. If it fires, the pong
    // never came back within the window, so the connection is dead.
    this.timeoutId = setTimeout(() => {
      this.stop();
      this.close();
    }, timeout);
  }

  onPong(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.intervalId = undefined;
    this.timeoutId = undefined;
  }
}

class RealWebSocket implements WebSocketLike {
  private socket: WebSocket;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.onopen = (ev) => this.onopen?.(ev);
    this.socket.onmessage = (ev) => this.onmessage?.({ data: ev.data });
    this.socket.onerror = (ev) => this.onerror?.(ev);
    this.socket.onclose = (ev) => this.onclose?.(ev);
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  get readyState(): number {
    return this.socket.readyState;
  }
}

class NullWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;
  readyState = NullWebSocket.CONNECTING;

  constructor(_url: string) {
    queueMicrotask(() => {
      if (this.readyState === NullWebSocket.CONNECTING) {
        this.readyState = NullWebSocket.OPEN;
        this.onopen?.({});
      }
    });
  }

  send(_data: string): void {
    // No network. The wrapper has already emitted EVENT_OUTBOUND for tracking.
  }

  close(): void {
    this.readyState = NullWebSocket.CLOSED;
    this.onclose?.({});
  }

  // Test seam reached from StubbedServer. Not part of WebSocketLike.
  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }
}

export class StubbedServer {
  constructor(private readonly socket: NullWebSocket) {}

  send(message: ServerMessage): void {
    this.socket.deliver(JSON.stringify(message));
  }

  sendRaw(payload: unknown): void {
    this.socket.deliver(payload);
  }

  simulateClose(): void {
    this.socket.close();
  }
}

export class ClientSocketWrapper {
  private socket: WebSocketLike;
  private readonly url: string;
  private readonly createSocket: WebSocketFactory;
  private readonly emitter = new EventEmitter();
  private heartbeat?: Heartbeat;
  // Set only by the public close() path. The heartbeat also closes this socket
  // when a pong never arrives, but that is a detected failure, not a goodbye.
  private deliberateClose = false;
  private retryTimer?: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    url: string,
    create: WebSocketFactory,
    private readonly clientOptions?: ClientSocketOptions,
  ) {
    this.url = url;
    this.createSocket = create;
    this.socket = this.openSocket();
  }

  // One socket per attempt: every close retires its socket, and reconnect
  // builds a fresh one through the same factory.
  private openSocket(): WebSocketLike {
    const socket = this.createSocket(this.url);
    socket.onmessage = (event) => {
      try {
        const raw: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!isServerMessage(raw)) {
          console.error('Invalid server message shape', raw);
          return;
        }

        if (raw.type === 'pong') {
          this.heartbeat?.onPong();
        }

        this.emitter.emit(EVENT_INBOUND, raw);
      } catch (error) {
        console.error('Failed to parse server message', error);
      }
    };
    socket.onclose = () => {
      this.heartbeat?.stop();
      this.emitter.emit(CLIENT_DISCONNECTION_EVENT, {
        deliberate: this.deliberateClose,
      } satisfies SocketCloseEvent);
      if (!this.deliberateClose && (this.clientOptions?.reconnect ?? true)) {
        this.scheduleReconnect();
      }
    };
    return socket;
  }

  // An unexpected close reopens the connection. The first retry is instant;
  // a failed attempt closes its own socket, which lands back here.
  private scheduleReconnect(): void {
    if (this.retryTimer) {
      return; // one pending attempt at a time
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.socket = this.openSocket();
      this.connect().catch(() => {
        // the failed socket's close event schedules the next attempt
      });
    }, 0);
  }

  static create(
    url: string,
    options?: { token?: string },
    clientOptions?: ClientSocketOptions,
  ): ClientSocketWrapper {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`Invalid WebSocket URL: expected ws:// or wss://, got ${parsed.protocol}`);
    }
    if (options?.token) {
      parsed.searchParams.set('token', options.token);
    }
    return new ClientSocketWrapper(parsed.toString(), (u) => new RealWebSocket(u), clientOptions);
  }

  static createNull(clientOptions?: ClientSocketOptions): ClientSocketWrapper {
    return new ClientSocketWrapper('wss://null', (u) => new NullWebSocket(u), clientOptions);
  }

  get isConnected(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      if (this.socket.readyState === WebSocket.CLOSED) {
        reject(new Error('Socket already closed'));
        return;
      }

      let settled = false;
      this.socket.onopen = () => {
        this.heartbeat = new Heartbeat(
          () => {
            void this.send({ type: 'ping' });
          },
          () => {
            this.socket.close();
          },
          {
            pingIntervalMs: this.clientOptions?.pingIntervalMs ?? 0,
            pongTimeoutMs: this.clientOptions?.pongTimeoutMs ?? 0,
          },
        );

        this.heartbeat.start();

        if (!settled) {
          settled = true;
          resolve();
        }
      };
      this.socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket connection failed'));
        }
      };
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.deliberateClose = true;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      const teardown = this.onClose(() => {
        teardown();
        resolve();
      });
      this.socket.close();
    });
  }

  send(message: ClientMessage): Promise<void> {
    this.socket.send(JSON.stringify(message));
    this.emitter.emit(EVENT_OUTBOUND, message);
    return Promise.resolve();
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    const handler = (data: unknown) => {
      listener(data as ServerMessage);
    };
    this.emitter.on(EVENT_INBOUND, handler);
    return () => {
      this.emitter.off(EVENT_INBOUND, handler);
    };
  }

  onClose(listener: (event: SocketCloseEvent) => void): () => void {
    const handler = (data: unknown) => {
      listener(data as SocketCloseEvent);
    };
    this.emitter.on(CLIENT_DISCONNECTION_EVENT, handler);
    return () => {
      this.emitter.off(CLIENT_DISCONNECTION_EVENT, handler);
    };
  }

  trackMessages(): OutputTracker {
    return new OutputTracker(this.emitter, EVENT_OUTBOUND);
  }

  simulateServer(): StubbedServer {
    if (!(this.socket instanceof NullWebSocket)) {
      throw new Error('simulateServer() is only available on null sockets');
    }
    return new StubbedServer(this.socket);
  }
}
