import { ProcessWrapper } from '../infrastructure/process.ts';

interface Closable {
  close(): Promise<void>;
}

const DEFAULT_GRACE_MS = 5000;

// The shutdown policy, out of the boot shell so it can be tested: on a signal,
// arm the deadline, then close the app. A clean close exits 0; a close still
// pending when the deadline fires exits 1 rather than waiting for SIGKILL.
export class Shutdown {
  private readonly closable: Closable;
  private readonly proc: ProcessWrapper;
  private readonly graceMs: number;
  private shuttingDown = false;

  constructor(closable: Closable, proc: ProcessWrapper, options: { graceMs?: number } = {}) {
    this.closable = closable;
    this.proc = proc;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  }

  arm(): void {
    this.proc.onSignal(() => {
      this.handleShutdownSignal();
    });
  }

  private handleShutdownSignal(): void {
    // A second signal means it: exit hard, no second goodbye.
    if (this.shuttingDown) {
      this.proc.exit(1);
      return;
    }
    this.shuttingDown = true;
    const cancelDeadline = this.proc.startTimer(this.graceMs, () => {
      console.error('shutdown timed out, exiting hard');
      this.proc.exit(1);
    });
    void this.closable.close().then(
      () => {
        cancelDeadline();
        this.proc.exit(0);
      },
      (err: unknown) => {
        cancelDeadline();
        console.error('shutdown failed:', err);
        this.proc.exit(1);
      },
    );
  }
}
