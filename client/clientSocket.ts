import { EventEmitter, OutputTracker } from '../server/infrastructure/outputTracker.ts';
import { ClientMessage, ServerMessage } from '../shared/protocol.ts';

export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;
  const type = msg.type;

  switch (type) {
    case 'ready':
    case 'result':
      return typeof msg.id === 'string';
    case 'added':
    case 'changed':
    case 'removed':
      return typeof msg.collection === 'string' && typeof msg.id === 'string';
    case 'error':
      return (
        typeof msg.id === 'string' &&
        typeof msg.error === 'object' &&
        msg.error !== null &&
        typeof (msg.error as Record<string, unknown>).code === 'number' &&
        typeof (msg.error as Record<string, unknown>).message === 'string'
      );
    default:
      return false;
  }
}

interface ClientSocketInterface {
  connect(): Promise<void>;
  close(): Promise<void>;
  send(message: unknown): Promise<void>;
  get isConnected(): boolean;
  trackMessages(): OutputTracker;
  onMessage(listener: (message: ServerMessage) => void): () => void;
}

const EVENT_OUTBOUND = 'outbound';
const EVENT_INBOUND = 'inbound';

export class ClientSocketWrapper {
  private readonly client: ClientSocketInterface;

  private constructor(client: ClientSocketInterface) {
    this.client = client;
  }

  static create(url: string, options?: { token?: string }): ClientSocketWrapper {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`Invalid WebSocket URL: expected ws:// or wss://, got ${parsed.protocol}`);
    }
    if (options?.token) {
      parsed.searchParams.set('token', options.token);
    }

    return new ClientSocketWrapper(new RealClientSocket(parsed.toString()));
  }

  static createNull(): ClientSocketWrapper {
    return new ClientSocketWrapper(new StubbedClientSocket());
  }

  get isConnected(): boolean {
    return this.client.isConnected;
  }
  async connect(): Promise<void> {
    await this.client.connect();
  }
  async close(): Promise<void> {
    await this.client.close();
  }
  async send(message: ClientMessage): Promise<void> {
    await this.client.send(message);
  }
  onMessage(listener: (message: ServerMessage) => void): () => void {
    return this.client.onMessage(listener);
  }
  simulateServer(): StubbedServer {
    const stub = this.client as StubbedClientSocket;
    return stub.simulateServer();
  }
  trackMessages(): OutputTracker {
    return this.client.trackMessages();
  }
}

class RealClientSocket implements ClientSocketInterface {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private emitter = new EventEmitter();

  constructor(url: string) {
    this.url = url;
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.socket = new WebSocket(this.url);
      this.socket.onopen = () => {
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
      this.socket.onmessage = (event) => {
        try {
          const raw: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

          if (!isServerMessage(raw)) {
            console.error('Invalid server message shape', raw);
            return;
          }

          this.emitter.emit(EVENT_INBOUND, raw);
        } catch (error) {
          console.error('Failed to parse server message', error);
        }
      };
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.onclose = () => {
        resolve();
      };
      this.socket.close();
    });
  }

  send(message: unknown): Promise<void> {
    if (!this.socket) {
      return Promise.reject(new Error('Socket is not connected'));
    }
    this.socket.send(JSON.stringify(message));
    this.emitter.emit(EVENT_OUTBOUND, message);
    return Promise.resolve();
  }

  trackMessages(): OutputTracker {
    return new OutputTracker(this.emitter, EVENT_OUTBOUND);
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
}

export class StubbedServer {
  private _client: StubbedClientSocket;

  constructor(client: StubbedClientSocket) {
    this._client = client;
  }

  send(message: ServerMessage): void {
    this._client.receiveMessage(message);
  }
}

class StubbedClientSocket implements ClientSocketInterface {
  private _isConnected = false;
  private emitter = new EventEmitter();

  get isConnected(): boolean {
    return this._isConnected;
  }
  connect(): Promise<void> {
    this._isConnected = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this._isConnected = false;
    return Promise.resolve();
  }

  send(message: ClientMessage): Promise<void> {
    // Implementation for sending message
    this.emitter.emit(EVENT_OUTBOUND, message);

    return Promise.resolve();
  }

  simulateServer(): StubbedServer {
    return new StubbedServer(this);
  }

  receiveMessage(message: ServerMessage): void {
    this.emitter.emit(EVENT_INBOUND, message);
  }

  trackMessages(): OutputTracker {
    return new OutputTracker(this.emitter, EVENT_OUTBOUND);
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
}
