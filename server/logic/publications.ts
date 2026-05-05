import { ClientMessage, ReactiveStoreObserver } from '../../shared/protocol.ts';
import { MongoWrapper } from '../infrastructure/mongo.ts';
import { WebSocketWrapper } from '../infrastructure/websocket.ts';
import { ChangeEvent } from '../../shared/types.ts';

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
  private subscriptions = new Map<string, Map<string, () => void>>();
  private observer: ReactiveStoreObserver;

  constructor(
    mongo: MongoWrapper,
    ws: WebSocketWrapper,
    observer: ReactiveStoreObserver = { onMessage: () => {} },
  ) {
    this.mongo = mongo;
    this.ws = ws;
    this.observer = observer;
    this.ws.onDisconnect((clientId) => {
      this.tearDownClient(clientId);
    });
  }

  private notifyObserver(
    msg: ClientMessage,
    outcome: 'applied' | 'skipped' | 'failed',
    reason?: string,
  ): void {
    try {
      this.observer.onMessage(msg, outcome, reason);
    } catch (err) {
      console.error('Observer error:', err);
    }
  }

  private tearDownClient(clientId: string): void {
    const clientSubs = this.subscriptions.get(clientId);
    if (!clientSubs) return;

    for (const cleanup of clientSubs.values()) {
      cleanup();
    }

    this.subscriptions.delete(clientId);
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
        this.notifyObserver(message, 'failed', 'unknown-publication');
        return Promise.resolve();
      }

      const { collection, query } = queryFn();
      const docs = await this.mongo.find<{ _id: string }>(collection, query);

      for (const doc of docs) {
        this.ws.send(clientId, addedMessage(collection, doc));
      }
      this.ws.send(clientId, readyMessage(message.id));

      const cleanup = this.mongo.watchChanges(collection, (change: ChangeEvent) => {
        if (change.type === 'insert') {
          this.ws.send(clientId, addedMessage(collection, change.fields));
        }
      });

      let clientSubs = this.subscriptions.get(clientId);

      if (!clientSubs) {
        clientSubs = new Map();
        this.subscriptions.set(clientId, clientSubs);
      }

      const existing = clientSubs.get(message.id);
      if (existing) {
        existing();
      }

      clientSubs.set(message.id, cleanup);
      this.notifyObserver(message, 'applied', existing ? 'duplicate-sub-id' : undefined);
    } else if (message.type === 'unsubscribe') {
      const clientSubs = this.subscriptions.get(clientId);

      if (!clientSubs) {
        this.notifyObserver(message, 'skipped', 'unknown-sub-id');
        return Promise.resolve();
      }

      const cleanup = clientSubs.get(message.id);
      if (!cleanup) {
        this.notifyObserver(message, 'skipped', 'unknown-sub-id');
        return Promise.resolve();
      }

      cleanup();
      clientSubs.delete(message.id);

      if (clientSubs.size === 0) {
        this.subscriptions.delete(clientId);
      }

      this.notifyObserver(message, 'applied');
    }
    return Promise.resolve();
  }
}
