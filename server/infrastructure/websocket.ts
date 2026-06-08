import fastifyWebsocket from '@fastify/websocket';
import { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { EventEmitter, OutputTracker } from './outputTracker.ts';

const CONNECTION_EVENT = 'connection';
const DISCONNECTION_EVENT = 'disconnection';
const MESSAGE_EVENT = 'message';

interface ServerSocketLike {
  send(data: string): void;
  close(): void;
  onClose(cb: () => void): void;
}

interface ConnectionSource {
  onConnection(cb: (socket: ServerSocketLike) => unknown): void;
  close(): Promise<void>;
  start?(): Promise<void>;
  attach?(fastify: FastifyInstance): Promise<void>;
}

type ConnectionSourceFactory = () => ConnectionSource;

interface WebSocketInterface {
  start?(): Promise<void>;
  attach?(fastify: FastifyInstance): Promise<void>;
  close?(): Promise<void>;
  get clientCount(): number;
  send(clientId: string, message: unknown): void;
  broadcast(message: unknown): void;
  onDisconnect?(cb: (clientId: string) => void): () => void;
  trackConnections(): OutputTracker;
  trackDisconnections(): OutputTracker;
  trackMessages(): OutputTracker;
}

export class WebSocketWrapper implements WebSocketInterface {
  private source: ConnectionSource;
  private clients = new Map<string, { socket: ServerSocketLike; stub?: StubbedClient }>();
  private nextId = 0;
  private emitter = new EventEmitter();

  private constructor(factory: ConnectionSourceFactory) {
    this.source = factory();
    this.source.onConnection((socket) => this.handleConnection(socket));
  }

  static create(): WebSocketWrapper {
    return new WebSocketWrapper(() => new FastifyConnectionSource());
  }

  static createRawWs(options: { port: number }): WebSocketWrapper {
    return new WebSocketWrapper(() => new WsConnectionSource(options.port));
  }

  static createNull(): WebSocketWrapper {
    return new WebSocketWrapper(() => new NullConnectionSource());
  }

  async start(): Promise<void> {
    if (typeof this.source.start === 'function') {
      await this.source.start();
    }
  }

  async attach(fastify: FastifyInstance): Promise<void> {
    if (typeof this.source.attach === 'function') {
      await this.source.attach(fastify);
    }
  }

  async close(): Promise<void> {
    await this.source.close();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  simulateConnection(): StubbedClient {
    const sourceWithSimulate = this.source as {
      simulateConnection?: () => StubbedClient;
    };

    if (typeof sourceWithSimulate.simulateConnection !== 'function') {
      throw new Error('simulateConnection only available on null instance');
    }

    return sourceWithSimulate.simulateConnection();
  }

  send(clientId: string, message: unknown): void {
    const entry = this.clients.get(clientId);
    if (!entry) {
      return;
    }
    if (entry.stub) {
      entry.stub.messages.push(message);
    } else {
      entry.socket.send(JSON.stringify(message));
    }
  }

  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const entry of this.clients.values()) {
      if (entry.stub) {
        entry.stub.messages.push(message);
      } else {
        entry.socket.send(data);
      }
    }
  }

  onDisconnect(cb: (clientId: string) => void): () => void {
    const listener = (data: unknown): void => {
      if (isClientIdPayload(data)) {
        cb(data.clientId);
      }
    };
    this.emitter.on(DISCONNECTION_EVENT, listener);
    return () => {
      this.emitter.off(DISCONNECTION_EVENT, listener);
    };
  }

  trackConnections(): OutputTracker {
    return new OutputTracker(this.emitter, CONNECTION_EVENT);
  }

  trackDisconnections(): OutputTracker {
    return new OutputTracker(this.emitter, DISCONNECTION_EVENT);
  }

  trackMessages(): OutputTracker {
    return new OutputTracker(this.emitter, MESSAGE_EVENT);
  }

  private receiveMessage(clientId: string, message: unknown): void {
    this.emitter.emit(MESSAGE_EVENT, { clientId, message });
  }

  private disconnect(clientId: string): void {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      this.emitter.emit(DISCONNECTION_EVENT, { clientId });
    }
  }

  private handleConnection(socket: ServerSocketLike): unknown {
    const id = String(this.nextId++);
    this.clients.set(id, { socket });
    this.emitter.emit(CONNECTION_EVENT, { clientId: id });

    socket.onClose(() => {
      if (this.clients.has(id)) {
        this.clients.delete(id);
        this.emitter.emit(DISCONNECTION_EVENT, { clientId: id });
      }
    });

    const maybeCreateStub = (
      socket as ServerSocketLike & {
        __createStubClient?: (
          id: string,
          serverApi: {
            receiveMessage: (cid: string, m: unknown) => void;
            disconnect: (cid: string) => void;
          },
        ) => StubbedClient;
      }
    ).__createStubClient;

    if (typeof maybeCreateStub === 'function') {
      const stub = maybeCreateStub(id, {
        receiveMessage: (cid, m) => {
          this.receiveMessage(cid, m);
        },
        disconnect: (cid) => {
          this.disconnect(cid);
        },
      });
      const entry = this.clients.get(id);
      if (entry) {
        entry.stub = stub;
      }
      return stub;
    }

    return undefined;
  }
}

function isClientIdPayload(data: unknown): data is { clientId: string } {
  if (data === null || typeof data !== 'object') {
    return false;
  }

  return typeof (data as Record<string, unknown>).clientId === 'string';
}

class WsConnectionSource implements ConnectionSource {
  private wss: WebSocketServer | null = null;
  private listeners: ((s: ServerSocketLike) => unknown)[] = [];
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  onConnection(cb: (socket: ServerSocketLike) => unknown): void {
    this.listeners.push(cb);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        resolve();
      });
      this.wss.on('connection', (socket: WebSocket) => {
        const wrapped: ServerSocketLike = {
          send: (data: string) => {
            socket.send(data);
          },
          close: () => {
            socket.close();
          },
          onClose: (cb: () => void) => socket.on('close', cb),
        };
        for (const l of this.listeners) {
          l(wrapped);
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

class FastifyConnectionSource implements ConnectionSource {
  private fastify: FastifyInstance | null = null;
  private listeners: ((s: ServerSocketLike) => unknown)[] = [];

  onConnection(cb: (socket: ServerSocketLike) => unknown): void {
    this.listeners.push(cb);
  }

  async attach(fastify: FastifyInstance): Promise<void> {
    this.fastify = fastify;
    await fastify.register(fastifyWebsocket);
    fastify.get('/ws', { websocket: true }, (connection: WebSocket) => {
      const wrapped: ServerSocketLike = {
        send: (data: string) => {
          connection.send(data);
        },
        close: () => {
          connection.close();
        },
        onClose: (cb: () => void) => connection.on('close', cb),
      };
      for (const l of this.listeners) {
        l(wrapped);
      }
    });
  }

  async close(): Promise<void> {
    await this.fastify?.close();
  }
}

export class StubbedClient {
  readonly id: string;
  readonly messages: unknown[] = [];
  private serverApi: {
    receiveMessage: (cid: string, m: unknown) => void;
    disconnect: (cid: string) => void;
  };

  constructor(
    id: string,
    serverApi: {
      receiveMessage: (cid: string, m: unknown) => void;
      disconnect: (cid: string) => void;
    },
  ) {
    this.id = id;
    this.serverApi = serverApi;
  }

  send(message: unknown): void {
    this.serverApi.receiveMessage(this.id, message);
  }

  close(): void {
    this.serverApi.disconnect(this.id);
  }
}

class NullConnectionSource implements ConnectionSource {
  private listeners: ((s: ServerSocketLike) => unknown)[] = [];

  onConnection(cb: (socket: ServerSocketLike) => unknown): void {
    this.listeners.push(cb);
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  simulateConnection(): StubbedClient {
    let created: StubbedClient | undefined;
    const socket: ServerSocketLike & {
      __createStubClient?: (
        id: string,
        api: {
          receiveMessage: (cid: string, m: unknown) => void;
          disconnect: (cid: string) => void;
        },
      ) => StubbedClient;
    } = {
      send: (_data: string) => {
        /* no-op; server receives via StubbedClient */
      },
      close: () => {
        /* no-op; client.close triggers serverApi.disconnect */
      },
      onClose: (_cb: () => void) => {
        /* no-op for null */
      },
      __createStubClient: (id: string, api) => {
        const stub = new StubbedClient(id, api);
        created = stub;
        return stub;
      },
    };

    for (const l of this.listeners) {
      const result = l(socket);
      if (result instanceof StubbedClient) {
        return result;
      }
    }

    if (created) {
      return created;
    }
    throw new Error('NullConnectionSource simulateConnection failed to create stub client');
  }
}
