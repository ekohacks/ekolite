import { EventEmitter } from '../server/infrastructure/outputTracker.ts';
import { DataMsg } from '../shared/protocol.ts';

type StoredDoc = Record<string, unknown>;

function withId(id: string, fields: StoredDoc): StoredDoc & { _id: string } {
  return { _id: id, ...fields };
}

export class ReactiveStore {
  private serverMessages = new Map<string, Record<string, unknown>>();
  private emitter = new EventEmitter();

  handleMessage(msg: DataMsg): void {
    if (msg.type === 'added') {
      this.serverMessages.set(msg.id, msg?.fields ?? {});
      this.emitter.emit('change', null);
    }
  }

  getAll(): StoredDoc[] {
    return Array.from(this.serverMessages.entries()).map(([id, fields]) => withId(id, fields));
  }

  getById(id: string): StoredDoc | undefined {
    const fields = this.serverMessages.get(id);
    if (fields) {
      return withId(id, fields);
    }
    return undefined;
  }

  onChange(listener: () => void): void {
    this.emitter.on('change', listener);
  }
}
