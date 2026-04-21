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

function isEmptyObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Error) &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export class ConfigurableResponse {
  private queue: unknown[];

  constructor(responses: unknown[]) {
    for (const response of responses) {
      if (isEmptyObject(response)) {
        throw new Error(
          'Empty object {} is not a valid configurable response. Use [] for empty arrays or null explicitly.',
        );
      }
    }
    this.queue = [...responses];
  }

  hasNext(): boolean {
    return this.queue.length > 0;
  }

  next(): unknown {
    if (this.queue.length === 0) {
      throw new Error('ConfigurableResponse queue exhausted — no more responses configured');
    }
    const response = this.queue.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}
