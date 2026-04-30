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
        this.emitter.emit('change', null);
        break;

      case 'changed':
      case 'removed':
        throw new Error(`Not implemented: ${msg.type}`);

      default:
        assertNever(msg);
    }
  }

  getAll(): StoredDoc[] {
    return Array.from(this.docs.entries()).map(([id, fields]) => withId(id, fields));
  }

  getById(id: string): StoredDoc | undefined {
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
