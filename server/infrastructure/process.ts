import { EventEmitter, OutputTracker } from './outputTracker.ts';

export type Signal = 'SIGINT' | 'SIGTERM';

const EXIT_EVENT = 'exit';

interface ProcessLike {
  onSignal(handler: (signal: Signal) => void): void;
  exit(code: number): void;
  startTimer(ms: number, callback: () => void): () => void;
}

export class ProcessWrapper {
  private readonly proc: ProcessLike;
  private readonly emitter = new EventEmitter();

  private constructor(proc: ProcessLike) {
    this.proc = proc;
  }

  static create(): ProcessWrapper {
    return new ProcessWrapper(new RealProcess());
  }

  static createNull(): ProcessWrapper {
    return new ProcessWrapper(new StubbedProcess());
  }

  private requireStubbedProcess(): StubbedProcess {
    if (!(this.proc instanceof StubbedProcess)) {
      throw new Error('Method only available on null instance');
    }

    return this.proc;
  }

  onSignal(handler: (signal: Signal) => void): void {
    this.proc.onSignal(handler);
  }

  exit(code: number): void {
    this.emitter.emit(EXIT_EVENT, { code });
    this.proc.exit(code);
  }

  trackExits(): OutputTracker {
    return new OutputTracker(this.emitter, EXIT_EVENT);
  }

  startTimer(ms: number, callback: () => void): () => void {
    return this.proc.startTimer(ms, callback);
  }

  advanceTime(ms: number): void {
    this.requireStubbedProcess().advanceTime(ms);
  }

  simulateSignal(signal: Signal): void {
    this.requireStubbedProcess().simulateSignal(signal);
  }
}

class RealProcess implements ProcessLike {
  onSignal(handler: (signal: Signal) => void): void {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        handler(signal);
      });
    }
  }

  exit(code: number): void {
    process.exit(code);
  }

  startTimer(ms: number, callback: () => void): () => void {
    const timer = setTimeout(callback, ms);
    return () => {
      clearTimeout(timer);
    };
  }
}

interface StubbedTimer {
  dueAt: number;
  callback: () => void;
  live: boolean;
}

class StubbedProcess implements ProcessLike {
  private readonly handlers: ((signal: Signal) => void)[] = [];
  private readonly timers: StubbedTimer[] = [];
  private now = 0;

  onSignal(handler: (signal: Signal) => void): void {
    this.handlers.push(handler);
  }

  exit(_code: number): void {
    // Intentionally ignored. The stubbed process survives its own exit; the tracker holds the story.
  }

  startTimer(ms: number, callback: () => void): () => void {
    const timer = { dueAt: this.now + ms, callback, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  advanceTime(ms: number): void {
    const target = this.now + ms;

    while (true) {
      const nextTimer = this.timers.reduce<StubbedTimer | null>((earliest, timer) => {
        if (!timer.live || timer.dueAt > target) {
          return earliest;
        }

        if (earliest === null || timer.dueAt < earliest.dueAt) {
          return timer;
        }

        return earliest;
      }, null);

      if (nextTimer === null) {
        this.now = target;
        break;
      }

      this.now = nextTimer.dueAt;

      const index = this.timers.indexOf(nextTimer);
      this.timers.splice(index, 1);

      nextTimer.callback();
    }
  }

  simulateSignal(signal: Signal): void {
    for (const handler of [...this.handlers]) {
      handler(signal);
    }
  }
}
