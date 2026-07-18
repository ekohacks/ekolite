import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import {
  DataMsg,
  MethodMsg,
  ServerMessage,
  SubscribeMsg,
  UnsubscribeMsg,
} from '../shared/protocol.ts';
import { assertNever } from '../shared/helperFunctions.ts';
import { RpcError } from '../shared/types.ts';

export interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

interface SubscriptionState {
  // Kept so the subscription can be replayed verbatim over a reopened socket.
  name: string;
  params?: Record<string, unknown> | undefined;
  readyResolver: () => void;
  readyRejector: (error: unknown) => void;
  // Learned from the server: ready.collection when present, otherwise inferred
  // from the initial data buffered before ready. Undefined until then.
  collection?: string;
  // Set when the socket dies unexpectedly. A reviving subscription buffers its
  // incoming initial documents, and its next ready swaps them into the store.
  reviving?: boolean;
}

class SubscriptionHandleImpl implements SubscriptionHandle {
  readonly ready: Promise<void>;

  constructor(
    private manager: ConnectionManager,
    private subscriptionId: string,
    readyPromise: Promise<void>,
  ) {
    this.ready = readyPromise;
  }

  stop(): void {
    this.manager.stopSubscription(this.subscriptionId);
  }
}

const generateSubscriptionId = (): string => {
  return globalThis.crypto.randomUUID();
};

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class ConnectionManager {
  private readonly socket: ClientSocketWrapper;
  private readonly stores = new Map<string, ReactiveStore>();
  private readonly subscriptions = new Map<string, SubscriptionState>();
  private readonly teardownMessageListener: () => void;
  private readonly teardownCloseListener: () => void;
  private readonly teardownOpenListener: () => void;
  private disposed = false;
  // Initial `added` documents that arrive before their subscription has learned
  // its collection. Held here until the matching `ready` binds the collection,
  // then flushed into the store. See handleServerMessage.
  private pendingData: DataMsg[] = [];
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(socket: ClientSocketWrapper) {
    this.socket = socket;
    // The disposed flag is consulted in three places to enforce the lifecycle contract:
    // (1) in the message listener to ignore incoming messages after disposal,
    // (2) in store() to prevent resurrecting stores, and
    // (3) in subscribe() to prevent creating new subscriptions.
    this.teardownMessageListener = this.socket.onMessage((message) => {
      if (!this.disposed) {
        this.handleServerMessage(message);
      }
    });
    this.teardownCloseListener = this.socket.onClose((event) => {
      if (event.deliberate) {
        this.dispose();
        return;
      }
      // The socket comes back on its own, so subscriptions and stores wait
      // for it. Calls cannot: their results died with the connection.
      this.rejectPendingCalls();
      for (const subscription of this.subscriptions.values()) {
        subscription.reviving = true;
      }
    });
    this.teardownOpenListener = this.socket.onOpen(() => {
      this.resubscribeAll();
    });
  }

  // The reopened socket is a blank slate for the server: replay every live
  // subscription with its original id and params, so the same ready comes
  // back and the stores can catch up.
  private resubscribeAll(): void {
    for (const [id, subscription] of this.subscriptions) {
      const message: SubscribeMsg = {
        type: 'subscribe',
        id,
        name: subscription.name,
        ...(subscription.params ? { params: subscription.params } : {}),
      };
      this.socket.send(message).catch((error: unknown) => {
        console.error('Failed to resubscribe:', error);
      });
    }
  }

  call(name: string, ...args: unknown[]): Promise<unknown> {
    this.assertNotDisposed();

    const id = generateSubscriptionId();

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    const message: MethodMsg = {
      type: 'method',
      id,
      name,
      params: args,
    };

    this.socket.send(message).catch(() => {
      this.pendingRequests.delete(id);
    });

    return promise;
  }

  subscribe(name: string, params?: Record<string, unknown>): SubscriptionHandle {
    this.assertNotDisposed();

    const id = generateSubscriptionId();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;

    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    this.subscriptions.set(id, {
      name,
      params,
      readyResolver: resolveReady,
      readyRejector: rejectReady,
    });

    // The frame goes out now only if the socket is open. While it is still
    // connecting the subscription waits in the map, and resubscribeAll()
    // replays it when the socket opens. That keeps subscribe() safe to call
    // before the connection is up, as a React mount effect does at cold load
    // and during every reconnect gap.
    if (this.socket.isConnected) {
      const subscribeMessage: SubscribeMsg = {
        type: 'subscribe',
        id,
        name,
        ...(params ? { params } : {}),
      };

      this.socket.send(subscribeMessage).catch((error: unknown) => {
        this.subscriptions.delete(id);
        rejectReady(error);
      });
    }

    return new SubscriptionHandleImpl(this, id, ready);
  }

  stopSubscription(id: string): void {
    const unsubscribeMessage: UnsubscribeMsg = { type: 'unsubscribe', id };

    const subscription = this.subscriptions.get(id);

    if (subscription) {
      subscription.readyRejector(new Error('subscription stopped before ready'));
    }

    this.subscriptions.delete(id);

    this.socket.send(unsubscribeMessage).catch((error: unknown) => {
      console.error('Failed to send unsubscribe message:', error);
    });
  }

  store(collection: string): ReactiveStore {
    this.assertNotDisposed();
    let store = this.stores.get(collection);
    if (!store) {
      store = new ReactiveStore();
      this.stores.set(collection, store);
    }

    return store;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.teardownMessageListener();
    this.teardownCloseListener();
    this.teardownOpenListener();

    for (const id of Array.from(this.subscriptions.keys())) {
      this.stopSubscription(id);
    }

    this.rejectPendingCalls();

    this.subscriptions.clear();
    this.stores.clear();
    this.pendingData = [];
  }

  // No result can arrive over a closed connection, so settle every call still
  // waiting as a rejection the caller can catch, rather than leaving its
  // promise pending forever.
  private rejectPendingCalls(): void {
    for (const { reject } of this.pendingRequests.values()) {
      reject(new Error('connection closed'));
    }
    this.pendingRequests.clear();
  }

  // Test seam: exposes internal state so tests can assert teardown happened.
  activeSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('ConnectionManager is disposed');
    }
  }

  private isCollectionReviving(collection: string): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.collection === collection && sub.reviving) {
        return true;
      }
    }
    return false;
  }

  private isCollectionLive(collection: string): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.collection === collection) {
        return true;
      }
    }
    return false;
  }

  // True while at least one subscription is still waiting to learn its
  // collection from a ready. Only then do we hold onto data we cannot place
  // yet; once every sub is bound, unplaceable data is a late message to drop,
  // not initial data to buffer.
  private hasUnboundSubscription(): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.collection === undefined) {
        return true;
      }
    }
    return false;
  }

  // Route any buffered initial documents for a now-known collection into its
  // store, keeping the rest waiting for their own ready.
  private flushPending(collection: string): void {
    const remaining: DataMsg[] = [];
    for (const message of this.pendingData) {
      if (message.collection === collection) {
        this.store(collection).handleMessage(message);
      } else {
        remaining.push(message);
      }
    }
    this.pendingData = remaining;
  }

  // The replacement ready swaps the store's contents for the buffered initial
  // documents in one move: a document deleted while offline disappears, and
  // no observer ever sees the store empty in between.
  private replaceFromPending(collection: string): void {
    const replacement: DataMsg[] = [];
    const remaining: DataMsg[] = [];
    for (const message of this.pendingData) {
      if (message.collection === collection) {
        replacement.push(message);
      } else {
        remaining.push(message);
      }
    }
    this.pendingData = remaining;
    this.store(collection).replaceAll(replacement);
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'added': {
        if (this.isCollectionReviving(message.collection)) {
          // Initial documents of a resubscribe. Hold them so the stale view
          // stays on screen until the ready swaps it wholesale.
          this.pendingData.push(message);
        } else if (this.isCollectionLive(message.collection)) {
          this.store(message.collection).handleMessage(message);
        } else if (this.hasUnboundSubscription()) {
          // Initial data for a subscription that has not learned its collection
          // yet. Hold it until the matching ready binds the collection.
          this.pendingData.push(message);
        }
        break;
      }
      case 'changed':
      case 'removed': {
        // No buffering: changed/removed only ever apply to data already added,
        // so anything for a collection that is not live is a late message the
        // stop() gate drops.
        if (this.isCollectionLive(message.collection)) {
          this.store(message.collection).handleMessage(message);
        }
        break;
      }
      case 'ready': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          // The server names the collection on ready, so bind the subscription
          // to it and flush any initial data buffered before it arrived.
          subscription.collection = message.collection;
          if (subscription.reviving) {
            subscription.reviving = false;
            this.replaceFromPending(message.collection);
          } else {
            this.flushPending(message.collection);
          }
          subscription.readyResolver();
        }
        break;
      }
      case 'result': {
        const request = this.pendingRequests.get(message.id);

        if (request) {
          request.resolve(message.result);
          this.pendingRequests.delete(message.id);
        }

        break;
      }
      case 'pong':
        // result settles via its request; pong is a liveness signal already
        // consumed by the heartbeat in ClientSocketWrapper. Neither carries
        // application data, so there is nothing to route here.
        break;
      case 'error': {
        const request = this.pendingRequests.get(message.id);

        if (request) {
          request.reject(new RpcError(message.error.code, message.error.message));
          this.pendingRequests.delete(message.id);
          break;
        }

        const subscription = this.subscriptions.get(message.id);

        if (subscription) {
          subscription.readyRejector(new RpcError(message.error.code, message.error.message));
          this.subscriptions.delete(message.id);
        }
        break;
      }
      default:
        assertNever(message);
    }
  }
}
