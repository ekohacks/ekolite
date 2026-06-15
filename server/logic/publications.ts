import { ClientMessage, PublicationsObserver, PublicationsReasons } from '../../shared/protocol.ts';
import { assertNever, hasMongoOperator } from '../../shared/helperFunctions.ts';
import { MongoWrapper } from '../infrastructure/mongo.ts';
import { WebSocketWrapper } from '../infrastructure/websocket.ts';
import { ChangeEvent } from '../../shared/types.ts';

// Publication params stay loosely typed at the protocol boundary because
// client input is unknown
type PublicationDef = (params?: Record<string, unknown>) => { collection: string; query: object };

interface SubscriptionRecord {
  cleanup: () => void;
  // Document ids this subscription has sent `added` for and not yet sent
  // `removed` for. Mirrors the client's view of what's been delivered, not
  // the live Mongo state. When watcher 'update'/'delete' get wired through,
  // this is the field they update.
  documentIds: Set<string>;
  collection: string;
}

const addedMessage = (collection: string, doc: Record<string, unknown>) => ({
  type: 'added',
  collection,
  id: doc._id,
  fields: Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id')),
});

const changedMessage = (collection: string, doc: Record<string, unknown>) => ({
  type: 'changed',
  collection,
  id: doc._id,
  fields: Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id')),
});

const readyMessage = (subId: string, collection: string) => ({
  type: 'ready',
  id: subId,
  collection,
});

const removedMessage = (collection: string, docId: string) => ({
  type: 'removed',
  collection,
  id: docId,
});

export class Publications {
  private publications = new Map<string, PublicationDef>();
  private ws: WebSocketWrapper;
  private mongo: MongoWrapper;
  private subscriptions = new Map<string, Map<string, SubscriptionRecord>>();
  private observer: PublicationsObserver;

  constructor(
    mongo: MongoWrapper,
    ws: WebSocketWrapper,
    observer: PublicationsObserver = {
      onMessage: () => {
        /* empty */
      },
    },
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
    reason?: PublicationsReasons,
  ): void {
    try {
      this.observer.onMessage(msg, outcome, reason);
    } catch (err) {
      console.error('Observer error:', err);
    }
  }

  private sendPublicationError(
    clientId: string,
    message: ClientMessage,
    reason: PublicationsReasons,
    messageText: string,
    code: number,
  ): void {
    this.ws.send(clientId, {
      type: 'error',
      id: message.id,
      error: { code: code, message: messageText },
    });
    this.notifyObserver(message, 'failed', reason);
  }

  private tearDownClient(clientId: string): void {
    const clientSubs = this.subscriptions.get(clientId);
    if (!clientSubs) {
      return;
    }

    for (const { cleanup } of clientSubs.values()) {
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
        this.sendPublicationError(
          clientId,
          message,
          'unknown-publication',
          `Unknown publication: ${message.name}`,
          404,
        );
        return Promise.resolve();
      }

      if (message.params && hasMongoOperator(message.params)) {
        this.sendPublicationError(
          clientId,
          message,
          'invalid-params',
          'Invalid subscription params: mongo operators are not allowed',
          400,
        );
        return;
      }

      let collection: string;
      let query: object;

      try {
        ({ collection, query } = queryFn(message.params ?? {}));
      } catch (err) {
        const messageText =
          err instanceof Error
            ? `Publication query failed: ${err.message}`
            : 'Publication query failed';

        this.sendPublicationError(clientId, message, 'publication-query-failed', messageText, 400);
        return;
      }

      let docs;
      try {
        docs = await this.mongo.find<{ _id: string }>(collection, query);
      } catch (err) {
        const messageText =
          err instanceof Error
            ? `Publications Mongo find failed: ${err.message}`
            : 'Publications Mongo find failed';

        this.sendPublicationError(
          clientId,
          message,
          'publications-mongo-find-failed',
          messageText,
          400,
        );
        return;
      }

      const documentIds = new Set<string>();
      const collectionName = collection;

      for (const doc of docs) {
        documentIds.add(doc._id);
        this.ws.send(clientId, addedMessage(collection, doc));
      }
      this.ws.send(clientId, readyMessage(message.id, collection));

      const cleanup = this.mongo.watchChanges(collection, (change: ChangeEvent) => {
        switch (change.type) {
          case 'insert': {
            documentIds.add(change.id);
            this.ws.send(clientId, addedMessage(collection, { _id: change.id, ...change.fields }));
            break;
          }
          case 'update': {
            this.ws.send(
              clientId,
              changedMessage(collection, { _id: change.id, ...change.fields }),
            );
            break;
          }
          case 'remove': {
            documentIds.delete(change.id);
            this.ws.send(clientId, removedMessage(collection, change.id));
            break;
          }
          default: {
            assertNever(change);
          }
        }
      });

      let clientSubs = this.subscriptions.get(clientId);

      if (!clientSubs) {
        clientSubs = new Map();
        this.subscriptions.set(clientId, clientSubs);
      }

      const existing = clientSubs.get(message.id);
      if (existing) {
        existing.cleanup();
      }

      clientSubs.set(message.id, { cleanup, documentIds, collection: collectionName });

      if (existing) {
        this.notifyObserver(message, 'applied', 'duplicate-sub-id');
      } else {
        this.notifyObserver(message, 'applied');
      }
    } else if (message.type === 'unsubscribe') {
      // Current assumption:
      // a document belongs to at most one active publication per client.
      // If overlapping publications are introduced,
      // unsubscribe logic must move to refcounted document ownership.

      const clientSubs = this.subscriptions.get(clientId);

      if (!clientSubs) {
        this.notifyObserver(message, 'skipped', 'unknown-sub-id');
        return Promise.resolve();
      }

      const subscriptionRecord = clientSubs.get(message.id);
      if (!subscriptionRecord) {
        this.notifyObserver(message, 'skipped', 'unknown-sub-id');
        return Promise.resolve();
      }

      subscriptionRecord.cleanup();

      for (const docId of subscriptionRecord.documentIds) {
        this.ws.send(clientId, removedMessage(subscriptionRecord.collection, docId));
      }

      clientSubs.delete(message.id);

      if (clientSubs.size === 0) {
        this.subscriptions.delete(clientId);
      }

      this.notifyObserver(message, 'applied');
    }
    return Promise.resolve();
  }
}
