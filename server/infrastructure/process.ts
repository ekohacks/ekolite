import { EventEmitter, OutputTracker } from './outputTracker.ts';

export type Signal = 'SIGINT' | 'SIGTERM';

const EXIT_EVENT = 'exit';

interface ProcessLike {
  onSignal(handler: (signal: Signal) => void): void;
  exit(code: number): void;
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

  simulateSignal(signal: Signal): void {
    if (!(this.proc instanceof StubbedProcess)) {
      throw new Error('simulateSignal only available on null instance');
    }
    this.proc.simulateSignal(signal);
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
}

class StubbedProcess implements ProcessLike {
  private readonly handlers: ((signal: Signal) => void)[] = [];

  onSignal(handler: (signal: Signal) => void): void {
    this.handlers.push(handler);
  }

  exit(): void {
    // The nulled process survives its own exit; the tracker holds the story.
  }

  simulateSignal(signal: Signal): void {
    for (const handler of [...this.handlers]) {
      handler(signal);
    }
  }
}
