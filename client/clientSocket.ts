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

interface Clock {
  now: () => number;
}

export class Heartbeat {
  private intervalId?: ReturnType<typeof setInterval> | undefined;
  private timeoutId?: ReturnType<typeof setTimeout> | undefined;
  private lastPongAt = 0;

  constructor(
    private readonly sendPing: HeartbeatSender,
    private readonly close: HeartbeatCloser,
    private readonly options: ClientSocketOptions,
    private readonly clock: Clock = { now: () => Date.now() },
  ) {}

  start(now = this.clock.now()): void {
    this.lastPongAt = now;

    this.intervalId = setInterval(() => {
      const now = this.clock.now();

      this.sendPing();

      const timedOut = now - this.lastPongAt > (this.options.pongTimeoutMs ?? 0);

      if (timedOut) {
        this.stop();
        this.close();
      }
    }, this.options.pingIntervalMs);
  }

  onPong(): void {
    this.lastPongAt = this.clock.now();
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
  private readonly socket: WebSocketLike;
  private readonly emitter = new EventEmitter();
  private heartbeat?: Heartbeat;

  private constructor(
    url: string,
    create: WebSocketFactory,
    private readonly clientOptions: ClientSocketOptions = {},
  ) {
    this.socket = create(url);
    this.socket.onmessage = (event) => {
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
    this.socket.onclose = () => {
      this.heartbeat?.stop();
      this.emitter.emit(CLIENT_DISCONNECTION_EVENT);
    };
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
            pingIntervalMs: this.clientOptions.pingIntervalMs ?? 0,
            pongTimeoutMs: this.clientOptions.pongTimeoutMs ?? 0,
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

  onClose(listener: () => void): () => void {
    this.emitter.on(CLIENT_DISCONNECTION_EVENT, listener);
    return () => {
      this.emitter.off(CLIENT_DISCONNECTION_EVENT, listener);
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
