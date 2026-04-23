import { ClientMessage } from '../../shared/protocol.ts';
import { ChangeEvent } from '../../shared/types.ts';
import { MongoWrapper } from '../infrastructure/mongo.ts';
import { WebSocketWrapper } from '../infrastructure/websocket.ts';

type PublicationDef = () => { collection: string; query: object };

const addedMessage = (collection: string, doc: Record<string, unknown>) => ({
  type: 'added',
  collection,
  id: doc._id as string,
  fields: Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id')),
});

const readyMessage = (subId: string) => ({
  type: 'ready',
  id: subId,
});

export class Publications {
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

      const { collection, query } = queryFn();
      const docs = await this.mongo.find<{ _id: string }>(collection, query);

      for (const doc of docs) {
        this.ws.send(clientId, addedMessage(collection, doc));
      }
      this.ws.send(clientId, readyMessage(message.id));
      
      this.mongo.watchChanges(collection, (change) => {
        if (change.type === 'insert') {
          this.ws.send(clientId, addedMessage(collection, change.fields));
        }
      });

    }
    return Promise.resolve();
  }
}
