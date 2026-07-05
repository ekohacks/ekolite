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
  private readonly graceMs = DEFAULT_GRACE_MS;

  constructor(closable: Closable, proc: ProcessWrapper) {
    this.closable = closable;
    this.proc = proc;
  }

  arm(): void {
    this.proc.onSignal(() => {
      this.proc.startTimer(this.graceMs, () => {
        console.error('shutdown timed out, exiting hard');
        this.proc.exit(1);
      });
      void this.closable.close().then(() => {
        this.proc.exit(0);
      });
    });
  }
}
