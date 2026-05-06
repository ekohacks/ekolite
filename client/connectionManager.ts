import { ClientSocketWrapper } from './clientSocket.ts';
import { ReactiveStore } from './reactiveStore.ts';
import { ServerMessage, SubscribeMsg } from '../shared/protocol.ts';

interface SubscriptionHandle {
  stop(): void;
  ready: Promise<void>;
}

const generateSubscriptionId = (() => {
  let counter = 0;
  return (): string => {
    if (
      typeof globalThis.crypto !== 'undefined' &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }

    counter += 1;
    return `sub-${String(counter)}`;
  };
})();

export class ConnectionManager {
  private readonly socket: ClientSocketWrapper;
  private readonly stores = new Map<string, ReactiveStore>();
  private readonly pendingReadyResolvers = new Map<string, () => void>();

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

    this.pendingReadyResolvers.set(id, resolveReady);

    const subscribeMessage: SubscribeMsg = {
      type: 'subscribe',
      id,
      name,
    };

    this.socket.send(subscribeMessage).catch((error: unknown) => {
      this.pendingReadyResolvers.delete(id);
      rejectReady(error);
    });

    return {
      stop: () => {},
      ready,
    };
  }

  store(collection: string): ReactiveStore {
    let store = this.stores.get(collection);
    if (!store) {
      store = new ReactiveStore();
      this.stores.set(collection, store);
    }

    return store;
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'added':
      case 'changed':
      case 'removed':
        this.store(message.collection).handleMessage(message);
        break;
      case 'ready': {
        const resolveReady = this.pendingReadyResolvers.get(message.id);
        if (resolveReady) {
          resolveReady();
          this.pendingReadyResolvers.delete(message.id);
        }
        break;
      }
      default:
        break;
    }
  }
}
