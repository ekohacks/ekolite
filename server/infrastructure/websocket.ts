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
  onMessage?(cb: (message: unknown) => void): void;
}

interface ConnectionSource {
  onConnection(cb: (socket: ServerSocketLike) => string): void;
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
  private clients = new Map<string, { socket: ServerSocketLike }>();
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
    if (message === undefined) {
      throw new Error('Cannot send undefined message to client');
    }

    const entry = this.clients.get(clientId);
    if (!entry) {
      return;
    }
    entry.socket.send(JSON.stringify(message));
  }

  broadcast(message: unknown): void {
    if (message === undefined) {
      throw new Error('Cannot broadcast undefined message to clients');
    }

    const data = JSON.stringify(message);
    for (const entry of this.clients.values()) {
      entry.socket.send(data);
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

  onMessage(cb: (clientId: string, message: unknown) => void): () => void {
    const listener = (data: unknown): void => {
      if (isClientMessagePayload(data)) {
        cb(data.clientId, data.message);
      }
    };
    this.emitter.on(MESSAGE_EVENT, listener);
    return () => {
      this.emitter.off(MESSAGE_EVENT, listener);
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

  private handleConnection(socket: ServerSocketLike): string {
    const id = String(this.nextId++);
    this.clients.set(id, { socket });
    socket.onMessage?.((message: unknown) => {
      this.receiveMessage(id, message);
    });
    this.emitter.emit(CONNECTION_EVENT, { clientId: id });

    socket.onClose(() => {
      if (this.clients.has(id)) {
        this.clients.delete(id);
        this.emitter.emit(DISCONNECTION_EVENT, { clientId: id });
      }
    });

    return id;
  }
}

function isClientIdPayload(data: unknown): data is { clientId: string } {
  if (data === null || typeof data !== 'object') {
    return false;
  }

  return typeof (data as Record<string, unknown>).clientId === 'string';
}

function isClientMessagePayload(data: unknown): data is { clientId: string; message: unknown } {
  if (data === null || typeof data !== 'object') {
    return false;
  }

  return typeof (data as Record<string, unknown>).clientId === 'string' && 'message' in data;
}

class WsConnectionSource implements ConnectionSource {
  private wss: WebSocketServer | null = null;
  private listeners: ((socket: ServerSocketLike) => string)[] = [];
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  onConnection(cb: (socket: ServerSocketLike) => string): void {
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
          onMessage(cb: (message: unknown) => void) {
            socket.on('message', (data: Buffer) => {
              cb(JSON.parse(data.toString()));
            });
          },
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
  private listeners: ((s: ServerSocketLike) => string)[] = [];

  onConnection(cb: (socket: ServerSocketLike) => string): void {
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
        onMessage(cb: (message: unknown) => void) {
          connection.on('message', (data: Buffer) => {
            cb(JSON.parse(data.toString()));
          });
        },
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
  constructor(
    readonly id: string,
    private readonly socket: NullServerSocket,
  ) {}

  get messages(): unknown[] {
    return this.socket.messages;
  }

  send(message: unknown): void {
    this.socket.receiveMessage(message);
  }

  close(): void {
    this.socket.close();
  }
}

class NullServerSocket implements ServerSocketLike {
  readonly messages: unknown[] = [];
  private closeHandler: (() => void) | undefined;
  private messageHandler: ((message: unknown) => void) | undefined;

  onClose(cb: () => void): void {
    this.closeHandler = cb;
  }
  send(data: string): void {
    this.messages.push(JSON.parse(data));
  }
  close(): void {
    this.closeHandler?.();
  }
  onMessage(cb: (message: unknown) => void): void {
    this.messageHandler = cb;
  }
  receiveMessage(message: unknown): void {
    this.messageHandler?.(message);
  }
}

class NullConnectionSource implements ConnectionSource {
  private listenersList: ((socket: ServerSocketLike) => string)[] = [];

  onConnection(cb: (socket: ServerSocketLike) => string): void {
    this.listenersList.push(cb);
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
  simulateConnection(): StubbedClient {
    const socket = new NullServerSocket();
    let id = '';

    for (const listener of this.listenersList) {
      id = listener(socket);
    }
    return new StubbedClient(id, socket);
  }
}
