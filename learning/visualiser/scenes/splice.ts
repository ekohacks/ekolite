type Mode = 'live' | 'snapshot';

interface Handler {
  name: string;
  removes?: string;
}

type Step = { name: string; index: number };
type StepRecord = { name: string; index: number; liveAfter: string[] };

export class SpliceScene {
  private handlers: Handler[] = [];
  private registered: string[] = [];
  private _mode: Mode = 'snapshot';
  private _lastRun: string[] = [];
  private _lastSteps: StepRecord[] = [];
  private stepCallbacks: Array<(step: Step) => void> = [];

  addHandler(name: string, options?: { removes?: string }): void {
    const handler: Handler = { name };
    if (options?.removes !== undefined) {
      handler.removes = options.removes;
    }
    this.handlers.push(handler);
    this.registered.push(name);
  }

  setMode(mode: Mode): void {
    this._mode = mode;
  }

  trigger(): void {
    this._lastRun = [];
    this._lastSteps = [];
    const list = this._mode === 'snapshot' ? [...this.handlers] : this.handlers;
    for (let i = 0; i < list.length; i++) {
      const handler = list[i];
      this._lastRun.push(handler.name);
      for (const cb of this.stepCallbacks) {
        cb({ name: handler.name, index: i });
      }
      if (handler.removes !== undefined) {
        this.removeHandler(handler.removes);
      }
      this._lastSteps.push({
        name: handler.name,
        index: i,
        liveAfter: this.handlers.map((h) => h.name),
      });
    }
  }

  reset(): void {
    this.handlers = [];
    this.registered = [];
    this._lastRun = [];
    this._lastSteps = [];
  }

  onStep(cb: (step: Step) => void): void {
    this.stepCallbacks.push(cb);
  }

  get lastRun(): string[] {
    return [...this._lastRun];
  }

  get handlerCount(): number {
    return this.handlers.length;
  }

  get mode(): Mode {
    return this._mode;
  }

  get registeredNames(): string[] {
    return [...this.registered];
  }

  get liveHandlerNames(): string[] {
    return this.handlers.map((h) => h.name);
  }

  get lastSteps(): StepRecord[] {
    return this._lastSteps.map((s) => ({ ...s, liveAfter: [...s.liveAfter] }));
  }

  private removeHandler(name: string): void {
    const idx = this.handlers.findIndex((h) => h.name === name);
    if (idx > -1) {
      this.handlers.splice(idx, 1);
    }
  }
}
