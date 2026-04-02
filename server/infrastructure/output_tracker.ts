export class EventEmitter {
  private handlers: Map<string, ((data: unknown) => void)[]> = new Map();

  on(eventType: string, handler: (data: unknown) => void): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)?.push(handler);
  }

  emit(eventType: string, data: unknown): void {
    const handlers = this.handlers.get(eventType) ?? [];
    for (const handler of handlers) {
      handler(data);
    }
  }
}

export class OutputTracker {
  private _data: unknown[] = [];

  constructor(emitter: EventEmitter, eventType: string) {
    emitter.on(eventType, (data: unknown) => {
      this._data.push(data);
    });
  }

  get data(): unknown[] {
    return [...this._data];
  }
}
