import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import { ServerMessage, SubscribeMsg, UnsubscribeMsg } from '../shared/protocol.ts';

interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

interface SubscriptionState {
  readyResolver: () => void;
  readyRejector: (error: unknown) => void;
}

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
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

export class ConnectionManager {
  private readonly socket: ClientSocketWrapper;
  private readonly stores = new Map<string, ReactiveStore>();
  private readonly subscriptions = new Map<string, SubscriptionState>();

  constructor(socket: ClientSocketWrapper) {
    this.socket = socket;
    this.socket.onMessage((message) => {
      this.handleServerMessage(message);
    });
  }

  subscribe(name: string): SubscriptionHandle {
    const id = generateSubscriptionId();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;

    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    this.subscriptions.set(id, {
      readyResolver: resolveReady,
      readyRejector: rejectReady,
    });

    const subscribeMessage: SubscribeMsg = {
      type: 'subscribe',
      id,
      name,
    };

    this.socket.send(subscribeMessage).catch((error: unknown) => {
      this.subscriptions.delete(id);
      rejectReady(error);
    });

    return new SubscriptionHandleImpl(this, id, ready);
  }

  stopSubscription(id: string): void {
    const unsubscribeMessage: UnsubscribeMsg = { type: 'unsubscribe', id };

    this.subscriptions.delete(id);

    this.socket.send(unsubscribeMessage).catch((error: unknown) => {
      console.error('Failed to send unsubscribe message:', error);
    });
  }

  store(collection: string): ReactiveStore {
    let store = this.stores.get(collection);
    if (!store) {
      store = new ReactiveStore();
      this.stores.set(collection, store);
    }

    return store;
  }

  activeSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'added':
      case 'changed':
      case 'removed': {
        this.store(message.collection).handleMessage(message);
        break;
      }
      case 'ready': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          subscription.readyResolver();
        }
        break;
      }
      case 'result':
        throw new Error('result messages yet to be implemented');
      case 'error': {
        const subscription = this.subscriptions.get(message.id);
        if (subscription) {
          subscription.readyRejector(message.error);
          this.subscriptions.delete(message.id);
        }
        break;
      }
      default:
        assertNever(message);
    }
  }
}
