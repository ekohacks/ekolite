import { EventEmitter, OutputTracker } from '../server/infrastructure/output_tracker.ts';
import { ClientMessage, ServerMessage } from '../shared/protocol.ts';

interface ClientSocketInterface {
  connect(): Promise<void>;
  close(): Promise<void>;
  send(message: unknown): Promise<void>;
  get isConnected(): boolean;
  trackMessages(): OutputTracker;
}

const EVENT_MESSAGES = 'message';

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
    return Promise.resolve();
  }

  trackMessages(): OutputTracker {
    return new OutputTracker(this.emitter, EVENT_MESSAGES);
  }
}

export class StubbedServer {
  private _client: StubbedClientSocket;
  readonly messages = [] as ServerMessage[];

  constructor(client: StubbedClientSocket) {
    this._client = client;
  }

  send(message: ServerMessage): void {
    this._client.onMessage(message);
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
    this.emitter.emit(EVENT_MESSAGES, message);

    return Promise.resolve();
  }

  simulateServer(): StubbedServer {
    return new StubbedServer(this);
  }

  onMessage(message: ServerMessage): void {
    this.emitter.emit('message', message);
  }

  trackMessages(): OutputTracker {
    return new OutputTracker(this.emitter, EVENT_MESSAGES);
  }
}
