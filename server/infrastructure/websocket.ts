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
  setClientId?(id: string): void; // For NullConnectionSource to set the stub's ID
  setReceiveMessageHandler?(handler: (message: unknown) => void): void; // For NullConnectionSource to handle incoming messages
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
  private clients = new Map<string, { socket: ServerSocketLike }>();
  private nextId = 0;
  private emitter = new EventEmitter();

  private constructor(factory: ConnectionSourceFactory) {
    this.source = factory();
    this.source.onConnection((socket) => {
      this.handleConnection(socket);
    });
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
    entry.socket.send(JSON.stringify(message));
  }

  broadcast(message: unknown): void {
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

  private handleConnection(socket: ServerSocketLike): void {
    const id = String(this.nextId++);
    this.clients.set(id, { socket });
    socket.setClientId?.(id); // For NullConnectionSource: set the stub's ID

    socket.setReceiveMessageHandler?.((message: unknown) => {
      this.receiveMessage(id, message);
    });

    this.emitter.emit(CONNECTION_EVENT, { clientId: id });

    socket.onClose(() => {
      if (this.clients.has(id)) {
        this.clients.delete(id);
        this.emitter.emit(DISCONNECTION_EVENT, { clientId: id });
      }
    });

    // For NullConnectionSource: set the stub's ID and receiveMessageHandler
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
  readonly messages: unknown[];
  id: string; // Mutable for testing, set by handleConnection
  private closeHandler: (() => void) | undefined;
  private receiveMessageHandler: ((message: unknown) => void) | undefined;

  constructor(
    messages: unknown[],
    closeHandler?: () => void,
    receiveMessageHandler?: (message: unknown) => void,
  ) {
    // Temporary ID, will be set by handleConnection via setId()
    this.id = '';
    this.messages = messages;
    this.closeHandler = closeHandler;
    this.receiveMessageHandler = receiveMessageHandler;
  }

  setId(id: string): void {
    this.id = id;
  }

  setReceiveMessageHandler(handler: (message: unknown) => void): void {
    this.receiveMessageHandler = handler;
  }

  send(message: unknown): void {
    // Track inbound messages (from client to server)
    this.receiveMessageHandler?.(message);
  }

  close(): void {
    this.closeHandler?.();
  }
}

class NullConnectionSource implements ConnectionSource {
  private listeners: ((s: ServerSocketLike) => unknown)[] = [];
  lastCreatedStub: StubbedClient | undefined;

  onConnection(cb: (socket: ServerSocketLike) => unknown): void {
    this.listeners.push(cb);
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  simulateConnection(): StubbedClient {
    const messages: unknown[] = [];
    let onCloseCallback: (() => void) | undefined;

    const socket: ServerSocketLike = {
      send: (data: string) => {
        // Null socket: record in-memory instead of sending over network
        messages.push(JSON.parse(data));
      },
      close: () => {
        // UNIFIED: call onClose callback like real socket does
        onCloseCallback?.();
      },
      onClose: (cb: () => void) => {
        onCloseCallback = cb;
      },

      setClientId: (id: string) => {
        this.lastCreatedStub?.setId(id);
      },
    };

    // Create stub with shared messages reference
    // ID and receiveMessageHandler will be set by handleConnection
    const stub = new StubbedClient(messages, () => onCloseCallback?.());

    this.lastCreatedStub = stub;

    // Call listeners to register this socket (e.g., handleConnection)
    for (const l of this.listeners) {
      l(socket);
    }

    return stub;
  }
}
