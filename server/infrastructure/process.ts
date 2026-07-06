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

  private requireStubbedProcess(errorMethod: 'advanceTime' | 'simulateSignal'): StubbedProcess {
    if (!(this.proc instanceof StubbedProcess)) {
      throw new Error(`${errorMethod} only available on null instance`);
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
    this.requireStubbedProcess('advanceTime').advanceTime(ms);
  }

  simulateSignal(signal: Signal): void {
    this.requireStubbedProcess('simulateSignal').simulateSignal(signal);
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

  exit(): void {
    // The nulled process survives its own exit; the tracker holds the story.
  }

  startTimer(ms: number, callback: () => void): () => void {
    const timer = { dueAt: this.now + ms, callback, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  advanceTime(ms: number): void {
    this.now += ms;
    for (const timer of [...this.timers]) {
      if (timer.live && timer.dueAt <= this.now) {
        timer.live = false;
        timer.callback();
      }
    }
  }

  simulateSignal(signal: Signal): void {
    for (const handler of [...this.handlers]) {
      handler(signal);
    }
  }
}
