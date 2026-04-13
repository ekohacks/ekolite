import { WebSocket } from 'ws';
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

export class ClientSocket {
  private client: ClientSocketInterface;

  private constructor(client: ClientSocketInterface) {
    this.client = client;
  }

  static create(url: string): ClientSocket {
    return new ClientSocket(new RealClientSocket(url));
  }

  static createNull(): ClientSocket {
    // Implementation for null socket
    return new ClientSocket(new StubbedClientSocket());
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
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.socket = new WebSocket(this.url);
      this.socket.onopen = () => {
        resolve();
      };
      // this.socket.onerror = (err) => reject(err);
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
  send(): Promise<void> {
    return Promise.resolve();
  }
  trackMessages(): OutputTracker {
    return new OutputTracker(new EventEmitter(), '');
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
