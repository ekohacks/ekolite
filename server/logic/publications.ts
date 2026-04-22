import { ClientMessage } from '../../shared/protocol.ts';
import { MongoWrapper } from '../infrastructure/mongo.ts';
import { WebSocketWrapper } from '../infrastructure/websocket.ts';

interface PublicationInterface {
  define(name: string, queryFn: (params: unknown) => void): void;
  handleMessage(clientId: string, message: ClientMessage): Promise<void>;
}

export class Publications implements PublicationInterface {
  private publications: Map<string, (params: unknown) => unknown> = new Map();
  private ws: WebSocketWrapper;
  private mongo: MongoWrapper;

  constructor(mongo: MongoWrapper, ws: WebSocketWrapper) {
    this.ws = ws;
    this.mongo = mongo;
  }

  define(name: string, queryFn: (params: unknown) => unknown): void {
    this.publications.set(name, queryFn);
  }

  handleMessage(clientId: string, message: ClientMessage): Promise<void> {
    if (message.type === 'subscribe') {
      const queryFn = this.publications.get(message.name);
      if (!queryFn) {
        this.ws.send(clientId, {
          type: 'error',
          id: message.id,
          error: { code: 404, message: `Unknown publication: ${message.name}` },
        });
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }
}
