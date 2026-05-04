import { EventEmitter } from '../server/infrastructure/outputTracker.ts';
import { DataMsg } from '../shared/protocol.ts';

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

  handleMessage(msg: DataMsg): void {
    switch (msg.type) {
      case 'added':
        this.docs.set(msg.id, msg.fields ?? {});
        break;

      case 'changed': {
        const existing = this.docs.get(msg.id);
        if (!existing) {
          return;
        }

        this.docs.set(msg.id, { ...existing, ...msg.fields });
        break;
      }

      case 'removed':
        if (!this.docs.has(msg.id)) {
          return;
        }
        this.docs.delete(msg.id);
        break;

      default:
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
