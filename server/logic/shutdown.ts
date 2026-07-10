import { ProcessWrapper } from '../infrastructure/process.ts';

interface Closable {
  close(): Promise<void>;
}

const DEFAULT_GRACE_MS = 5000;

// The shutdown policy, out of the boot shell so it can be tested: on a request to
// stop, arm the deadline, then close the app. A clean close exits 0; a close still
// pending when the deadline fires exits 1 rather than waiting for SIGKILL.
//
// The policy does not care which door the request came through. A SIGTERM from Docker,
// a Ctrl+C from a keyboard and a shutdown message from a supervisor all mean the same
// thing here, which is why the handler ignores its argument.
export class Shutdown {
  private readonly closable: Closable;
  private readonly proc: ProcessWrapper;
  private readonly graceMs: number;
  private shuttingDown = false;
  private exited = false;

  constructor(closable: Closable, proc: ProcessWrapper, options: { graceMs?: number } = {}) {
    this.closable = closable;
    this.proc = proc;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  }

  arm(): void {
    this.proc.onShutdownRequest(() => {
      this.handleShutdownRequest();
    });
  }

  private exitOnce(code: number): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.proc.exit(code);
  }

  private handleShutdownRequest(): void {
    // A second request means it: exit hard, no second goodbye.
    if (this.shuttingDown) {
      this.exitOnce(1);
      return;
    }
    this.shuttingDown = true;
    const cancelDeadline = this.proc.startTimer(this.graceMs, () => {
      console.error('shutdown timed out, exiting hard');
      this.exitOnce(1);
    });
    void this.closable.close().then(
      () => {
        if (this.exited) {
          return;
        }

        cancelDeadline();
        this.exited = true;
        this.proc.exit(0);
      },
      (err: unknown) => {
        if (this.exited) {
          return;
        }

        cancelDeadline();
        this.exited = true;
        console.error('shutdown failed:', err);
        this.proc.exit(1);
      },
    );
  }
}
