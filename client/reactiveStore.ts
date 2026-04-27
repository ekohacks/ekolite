import { DataMsg } from '../shared/protocol.ts';

export class ReactiveStore {
  private serverMessages = new Map<string, Record<string, unknown>>();

  handleMessage(msg: DataMsg): void {
    if (msg.type === 'added') {
      this.serverMessages.set(msg.id, msg?.fields ?? {});
    }
  }

  getAll(): Record<string, unknown>[] {
    return Array.from(this.serverMessages.entries()).map(([id, fields]) => ({
      _id: id,
      ...fields,
    }));
  }

  getById(id: string): Record<string, unknown> | undefined {
    const fields = this.serverMessages.get(id);
    if (fields) {
      return { _id: id, ...fields };
    }
    return undefined;
  }
}
