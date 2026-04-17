import fastifyWebsocket from '@fastify/websocket';
import { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { EventEmitter, OutputTracker } from './outputTracker.ts';

const CONNECTION_EVENT = 'connection';
const DISCONNECTION_EVENT = 'disconnection';
const MESSAGE_EVENT = 'message';

interface WebSocketInterface {
  start?(): Promise<void>;
  close?(): Promise<void>;
  get clientCount(): number;
  send(clientId: string, message: unknown): void;
  broadcast(message: unknown): void;
  trackConnections(): OutputTracker;
  trackDisconnections(): OutputTracker;
  trackMessages(): OutputTracker;
}

export class WebSocketWrapper {
  private server: WebSocketInterface;

  private constructor(server: WebSocketInterface) {
    this.server = server;
  }

  static create(fastify: FastifyInstance): WebSocketWrapper {
    return new WebSocketWrapper(new FastifyWebSocket(fastify));
  }

  static createRawWs(options: { port: number }): WebSocketWrapper {
    return new WebSocketWrapper(new RealWebSocket(options.port));
  }

  static createNull(): WebSocketWrapper {
    return new WebSocketWrapper(new StubbedWebSocket());
  }

  async start(): Promise<void> {
    await this.server.start?.();
  }

  async close(): Promise<void> {
    await this.server.close?.();
  }

  get clientCount(): number {
    return this.server.clientCount;
  }

  simulateConnection(): StubbedClient {
    const stub = this.server as StubbedWebSocket;
    return stub.simulateConnection();
  }

  send(clientId: string, message: unknown): void {
    this.server.send(clientId, message);
  }

  broadcast(message: unknown): void {
    this.server.broadcast(message);
  }

  trackConnections(): OutputTracker {
    return this.server.trackConnections();
  }

  trackDisconnections(): OutputTracker {
    return this.server.trackDisconnections();
  }

  trackMessages(): OutputTracker {
    return this.server.trackMessages();
  }
}

class RealWebSocket implements WebSocketInterface {
  private wss: WebSocketServer | null = null;
  private port: number;
  private clients = new Map<string, WebSocket>();
  private nextId = 0;

  constructor(port: number) {
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        resolve();
      });

      this.wss.on('connection', (socket) => {
        const id = String(this.nextId++);
        this.clients.set(id, socket);

        socket.on('close', () => {
          this.clients.delete(id);
        });
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

  get clientCount(): number {
    return this.clients.size;
  }

  send(clientId: string, message: unknown): void {
    const socket = this.clients.get(clientId);
    if (socket) {
      socket.send(JSON.stringify(message));
    }
  }

  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const socket of this.clients.values()) {
      socket.send(data);
    }
  }

  trackConnections(): OutputTracker {
    throw new Error('trackConnections is only available on null instances');
  }

  trackDisconnections(): OutputTracker {
    throw new Error('trackDisconnections is only available on null instances');
  }

  trackMessages(): OutputTracker {
    throw new Error('trackMessages is only available on null instances');
  }
}

class FastifyWebSocket implements WebSocketInterface {
  private fastify: FastifyInstance;
  private clients = new Map<string, WebSocket>();
  private nextId = 0;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
  }

  async start(): Promise<void> {
    await this.fastify.register(fastifyWebsocket);

    this.fastify.get('/ws', { websocket: true }, (socket) => {
      const id = String(this.nextId++);
      this.clients.set(id, socket);

      socket.on('close', () => {
        this.clients.delete(id);
      });
    });
  }

  async close(): Promise<void> {
    await this.fastify.close();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  send(clientId: string, message: unknown): void {
    const socket = this.clients.get(clientId);
    if (socket) {
      socket.send(JSON.stringify(message));
    }
  }

  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const socket of this.clients.values()) {
      socket.send(data);
    }
  }

  trackConnections(): OutputTracker {
    throw new Error('trackConnections is only available on null instances');
  }

  trackDisconnections(): OutputTracker {
    throw new Error('trackDisconnections is only available on null instances');
  }

  trackMessages(): OutputTracker {
    throw new Error('trackMessages is only available on null instances');
  }
}

export class StubbedClient {
  readonly id: string;
  readonly messages: unknown[] = [];
  private server: StubbedWebSocket;

  constructor(id: string, server: StubbedWebSocket) {
    this.id = id;
    this.server = server;
  }

  send(message: unknown): void {
    this.server.receiveMessage(this.id, message);
  }

  close(): void {
    this.server.disconnect(this.id);
  }
}

class StubbedWebSocket implements WebSocketInterface {
  private clients = new Map<string, StubbedClient>();
  private emitter = new EventEmitter();
  private nextId = 0;

  get clientCount(): number {
    return this.clients.size;
  }

  simulateConnection(): StubbedClient {
    const id = String(this.nextId++);
    const client = new StubbedClient(id, this);
    this.clients.set(id, client);
    this.emitter.emit(CONNECTION_EVENT, { clientId: id });
    return client;
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId);
    this.emitter.emit(DISCONNECTION_EVENT, { clientId });
  }

  receiveMessage(clientId: string, message: unknown): void {
    this.emitter.emit(MESSAGE_EVENT, { clientId, message });
  }

  send(clientId: string, message: unknown): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.messages.push(message);
    }
  }

  broadcast(message: unknown): void {
    for (const client of this.clients.values()) {
      client.messages.push(message);
    }
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
}
