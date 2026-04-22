import { ClientMessage } from '../../shared/protocol.ts';
import { MongoWrapper } from '../infrastructure/mongo.ts';
import { WebSocketWrapper } from '../infrastructure/websocket.ts';

interface PublicationInterface {
  define(name: string, queryFn: PublicationDef): void;
  handleMessage(clientId: string, message: ClientMessage): Promise<void>;
}

type PublicationDef = () => { collection: string; query: object };

export class PublicationsWrapper {
  private client: PublicationInterface;

  private constructor(client: PublicationInterface) {
    this.client = client;
  }

  static createNull(mongo: MongoWrapper, ws: WebSocketWrapper): PublicationsWrapper {
    return new PublicationsWrapper(new StubbedPublication(mongo, ws));
  }

  define(name: string, queryFn: PublicationDef): void {
    this.client.define(name, queryFn);
  }

  async handleMessage(clientId: string, message: ClientMessage): Promise<void> {
    return this.client.handleMessage(clientId, message);
  }
}

class StubbedPublication implements PublicationInterface {
  private publications = new Map<string, PublicationDef>();
  private ws: WebSocketWrapper;
  private mongo: MongoWrapper;

  constructor(mongo: MongoWrapper, ws: WebSocketWrapper) {
    this.mongo = mongo;
    this.ws = ws;
  }

  define(name: string, queryFn: PublicationDef): void {
    this.publications.set(name, queryFn);
  }

  async handleMessage(clientId: string, message: ClientMessage): Promise<void> {
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
