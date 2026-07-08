import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test infrastructure, not production infrastructure: a thin wrapper over
// child_process.spawn with no Nullable factory. It exists only to let the smoke test
// drive the real entry point as an operating system would, spawn it, wait for a line
// on stdout, then send it a signal, so it lives under tests/ and runs only in the
// integration suite.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY_POINT = 'server/start.ts';

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_GRACE_MS = 5_000;

export interface ServerProcessOptions {
  // The child is considered up once this string appears on stdout.
  readyString: string;
  // Merged over the parent env for the child; the isolation knobs live here.
  env?: Record<string, string>;
  readyTimeoutMs?: number;
  stopGraceMs?: number;
}

export interface ExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class ServerProcess {
  private readonly readyString: string;
  private readonly env: Record<string, string>;
  private readonly readyTimeoutMs: number;
  private readonly stopGraceMs: number;
  private child: ChildProcess | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';

  constructor(options: ServerProcessOptions) {
    this.readyString = options.readyString;
    this.env = options.env ?? {};
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  }

  get stdout(): string {
    return this.stdoutBuffer;
  }

  get stderr(): string {
    return this.stderrBuffer;
  }

  // Run start.ts in a single node process (tsx as an import hook, not a child of tsx),
  // so a later SIGTERM lands on the server itself and its exit code is the one we read.
  startAsync(): Promise<void> {
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY_POINT], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    const { stdout, stderr } = child;
    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
    });
    stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
    });

    return new Promise<void>((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        clearTimeout(timer);
        stdout.off('data', onData);
        child.off('exit', onExit);
      };

      const onData = () => {
        if (this.stdoutBuffer.includes(this.readyString)) {
          cleanup();
          resolvePromise();
        }
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        rejectPromise(
          new Error(
            `server exited before ready (code ${String(code)}, signal ${String(signal)}).\n` +
              `stdout:\n${this.stdoutBuffer}\nstderr:\n${this.stderrBuffer}`,
          ),
        );
      };

      const timer = setTimeout(() => {
        cleanup();
        rejectPromise(
          new Error(
            `server did not print ${JSON.stringify(this.readyString)} within ${String(this.readyTimeoutMs)}ms.\n` +
              `stdout:\n${this.stdoutBuffer}\nstderr:\n${this.stderrBuffer}`,
          ),
        );
      }, this.readyTimeoutMs);

      stdout.on('data', onData);
      child.once('exit', onExit);
      // Guard the case where the ready line was already buffered before we listened.
      onData();
    });
  }

  // SIGTERM and wait for the child to leave within the grace period. If it overstays,
  // SIGKILL it and throw, so a server that ignored the polite signal fails the test
  // rather than passing on a hard kill.
  async stopAsync(): Promise<ExitResult> {
    const child = this.child;
    if (child === null) {
      return { exitCode: null, signal: null };
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return { exitCode: child.exitCode, signal: child.signalCode };
    }

    child.kill('SIGTERM');
    const graceTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, this.stopGraceMs);

    const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    clearTimeout(graceTimer);

    if (signal === 'SIGKILL') {
      throw new Error(
        `server did not exit within ${String(this.stopGraceMs)}ms of SIGTERM; had to SIGKILL.\n` +
          `stderr:\n${this.stderrBuffer}`,
      );
    }

    return { exitCode: code, signal };
  }
}
