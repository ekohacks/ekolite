import { ProcessWrapper } from '../infrastructure/process.ts';

interface Closable {
  close(): Promise<void>;
}

// The shutdown policy, out of the boot shell so it can be tested: on a signal,
// close the app and exit 0.
export class Shutdown {
  private readonly closable: Closable;
  private readonly proc: ProcessWrapper;

  constructor(closable: Closable, proc: ProcessWrapper) {
    this.closable = closable;
    this.proc = proc;
  }

  arm(): void {
    this.proc.onSignal(() => {
      void this.closable.close().then(() => {
        this.proc.exit(0);
      });
    });
  }
}
