import { SHUTDOWN_MESSAGE } from '../../shared/serverMessages.ts';
import { EventEmitter, OutputTracker } from './outputTracker.ts';

// How the process was asked to stop. Two doors, and they are not interchangeable.
//
// SIGINT and SIGTERM are POSIX. On Windows Node will let you register a listener for
// either, and SIGINT fires when a human presses Ctrl+C in the console, but no parent
// process can generate one: the call you would need is GenerateConsoleCtrlEvent, and
// Node does not expose it. SIGTERM never fires there at all.
//
// 'message' is the door a supervisor can reach on every platform. It exists whenever
// the process was spawned with an `ipc` slot in stdio.
export type ShutdownRequest = 'SIGINT' | 'SIGTERM' | 'message';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
const EXIT_EVENT = 'exit';

interface ProcessLike {
  onShutdownRequest(handler: (request: ShutdownRequest) => void): void;
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

  onShutdownRequest(handler: (request: ShutdownRequest) => void): void {
    this.proc.onShutdownRequest(handler);
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

  simulateShutdownRequest(request: ShutdownRequest): void {
    this.requireStubbedProcess().simulateShutdownRequest(request);
  }
}

class RealProcess implements ProcessLike {
  onShutdownRequest(handler: (request: ShutdownRequest) => void): void {
    for (const signal of SHUTDOWN_SIGNALS) {
      process.on(signal, () => {
        handler(signal);
      });
    }

    // Costs nothing when there is no IPC channel: without an `ipc` slot in the parent's
    // stdio, 'message' never fires. With one, this is how a supervisor stops us on a
    // platform where it cannot raise a signal.
    process.on('message', (message) => {
      if (message === SHUTDOWN_MESSAGE) {
        handler('message');
      }
    });
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
  private readonly handlers: ((request: ShutdownRequest) => void)[] = [];
  private readonly timers: StubbedTimer[] = [];
  private now = 0;

  onShutdownRequest(handler: (request: ShutdownRequest) => void): void {
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

  simulateShutdownRequest(request: ShutdownRequest): void {
    for (const handler of [...this.handlers]) {
      handler(request);
    }
  }
}
