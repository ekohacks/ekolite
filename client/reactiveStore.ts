import { EventEmitter } from '../server/infrastructure/outputTracker.ts';
import { DataMsg, ReactiveStoreObserver } from '../shared/protocol.ts';

type StoredDoc = Record<string, unknown>;

type StoredDocWithId = StoredDoc & { _id: string };

function withId(id: string, fields: StoredDoc): StoredDocWithId {
  return { ...fields, _id: id };
}

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

export class ReactiveStore {
  private docs = new Map<string, Record<string, unknown>>();
  private emitter = new EventEmitter();
  private observer: ReactiveStoreObserver;

  constructor(observer: ReactiveStoreObserver = { onMessage: () => {} }) {
    this.observer = observer;
  }

  private notifyObserver(
    msg: DataMsg,
    outcome: 'applied' | 'skipped' | 'failed',
    reason?: string,
  ): void {
    try {
      this.observer.onMessage(msg, outcome, reason);
    } catch (err) {
      console.error('Observer error:', err);
    }
  }

  handleMessage(msg: DataMsg): void {
    switch (msg.type) {
      case 'added':
        this.docs.set(msg.id, msg.fields ?? {});
        this.notifyObserver(msg, 'applied');
        break;

      case 'changed': {
        const existing = this.docs.get(msg.id);
        if (!existing) {
          this.notifyObserver(msg, 'skipped', 'unknown-id');
          return;
        }

        this.docs.set(msg.id, { ...existing, ...msg.fields });
        this.notifyObserver(msg, 'applied');
        break;
      }

      case 'removed':
        if (!this.docs.has(msg.id)) {
          this.notifyObserver(msg, 'skipped', 'unknown-id');
          return;
        }
        this.docs.delete(msg.id);
        this.notifyObserver(msg, 'applied');
        break;

      default:
        this.notifyObserver(msg, 'failed', 'unsupported-message-type');
        assertNever(msg);
    }
    this.emitter.emit('change');
  }

  getAll(): StoredDocWithId[] {
    return Array.from(this.docs.entries()).map(([id, fields]) => withId(id, fields));
  }

  getById(id: string): StoredDocWithId | undefined {
    const fields = this.docs.get(id);
    if (fields) {
      return withId(id, fields);
    }
    return undefined;
  }

  onChange(listener: () => void): () => void {
    this.emitter.on('change', listener);

    return () => {
      this.emitter.off('change', listener);
    };
  }
}
