import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHUTDOWN_MESSAGE } from '../../shared/serverMessages.ts';

// Test infrastructure, not production infrastructure: a thin wrapper over
// child_process.spawn with no Nullable factory. It exists only to let the smoke test
// drive the real entry point as an operating system would, spawn it, wait for a line
// on stdout, then ask it to stop, so it lives under tests/ and runs only in the
// integration suite.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY_POINT = 'server/start.ts';

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_GRACE_MS = 5_000;

// Which door to knock on. A signal, or a shutdown message down the IPC channel.
export type Knock = 'signal' | 'message';

// Every platform check in this harness, in one named function, at the boundary.
// Modelled on build/util/build_command.js in James Shore's lets_code_javascript: two
// lines of platform knowledge in one place, and nothing else in the file ever asks
// what operating system it is running on.
//
// child.kill('SIGTERM') on Windows does not deliver a signal, it shoots the process.
// libuv folds SIGTERM into TerminateProcess, so no handler in the child ever runs and
// the exit event arrives as (null, 'SIGTERM'). The message door travels the IPC channel
// and works everywhere, so it is the knock we use where signals are not real.
export function defaultKnock(): Knock {
  return process.platform === 'win32' ? 'message' : 'signal';
}

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
  // so a later stop lands on the server itself and its exit code is the one we read.
  //
  // The fourth stdio slot opens the IPC channel. Without it child.send throws and the
  // server's process.on('message') never fires, which is to say: without it there is no
  // way for any supervisor to stop this server on Windows.
  startAsync(): Promise<void> {
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY_POINT], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...this.env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;

    // With a three slot stdio the spawn overload guarantees these pipes and TypeScript
    // knows it. The fourth slot drops us to the general ChildProcess signature, where
    // both are nullable. They are not null here, and if they ever were, every diagnostic
    // this harness gives would be an empty string, so say so out loud rather than assert.
    const { stdout, stderr } = child;
    if (stdout === null || stderr === null) {
      throw new Error('spawn returned no stdout or stderr pipe; the harness cannot see the server');
    }

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

  // The knock this platform's supervisors use. For teardown, where a graceful stop is
  // not the claim under test. The two named methods below are the doors themselves, and
  // a test that means to assert one of them must say which.
  stopAsync(): Promise<ExitResult> {
    return defaultKnock() === 'message' ? this.stopWithMessageAsync() : this.stopWithSignalAsync();
  }

  // Sends the message and nothing else. No fallback to a signal when nothing answers:
  // with one, a POSIX run would pass whether or not the message door works, and the only
  // platform that could catch that is the one that cannot run the test.
  stopWithMessageAsync(): Promise<ExitResult> {
    return this.knockAndWaitAsync((child) => {
      child.send(SHUTDOWN_MESSAGE);
    });
  }

  // The door Docker and systemd knock on. POSIX only: see defaultKnock.
  stopWithSignalAsync(): Promise<ExitResult> {
    return this.knockAndWaitAsync((child) => {
      child.kill('SIGTERM');
    });
  }

  // Knock, then wait for the child to leave within the grace period. If it overstays,
  // SIGKILL it and throw, so a server that ignored the polite request fails the test
  // rather than passing on a hard kill. This is not the fallback the message door
  // forbids: a SIGKILL here can only ever produce a thrown error, never a clean exit 0.
  private async knockAndWaitAsync(knock: (child: ChildProcess) => void): Promise<ExitResult> {
    const child = this.child;
    if (child === null) {
      return { exitCode: null, signal: null };
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      return { exitCode: child.exitCode, signal: child.signalCode };
    }

    knock(child);
    const graceTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, this.stopGraceMs);

    const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
    clearTimeout(graceTimer);

    if (signal === 'SIGKILL') {
      throw new Error(
        `server did not exit within ${String(this.stopGraceMs)}ms of the stop request; had to SIGKILL.\n` +
          `stderr:\n${this.stderrBuffer}`,
      );
    }

    return { exitCode: code, signal };
  }
}
