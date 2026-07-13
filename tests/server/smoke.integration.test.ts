import { afterEach, describe, expect, it } from 'vitest';
import { ServerProcess } from '../helpers/serverProcess.ts';
import { freePort } from '../helpers/freePort.ts';
import { READY_MESSAGE } from '../../shared/serverMessages.ts';

// The one test that bypasses every Null and drives the real entry point. It spawns
// server/start.ts as a child process, waits for it to announce readiness on stdout,
// fetches the home page, and asks it to stop.
//
// What it covers, and nothing else can: the wiring inside start.ts. App.create building
// the graph, createServer serving it, listen binding the port, and Shutdown.arm() meeting
// the real process. Shutdown policy is already tested against the Nulled process and is
// not repeated here; only the line where policy meets the operating system is.
//
// What it does not cover, despite what this comment used to claim: Mongo. The driver
// connects lazily and nothing here reads or writes, so the server boots and serves the
// home page with no database running at all. Verified by running it with mongod stopped.
// If start.ts stopped wiring Mongo tomorrow, this file would stay green.
//
// Integration only: it needs a real port and spawns a real process, so it lives in the
// integration config and runs under `npm run test:integration`.

// The home page is served from dist/client, so this asserts the built client is wired
// to `/`. The marker lives in client/index.html and survives the vite build.
const HOME_PAGE_MARKER = '<!-- ekolite home page -->';

// Lines the runtime may print to stderr that are noise, not a wiring fault. Empty in
// practice today; this is the seam to widen if a future node or tsx prints a warning.
const BENIGN_STDERR: RegExp[] = [/ExperimentalWarning/, /--trace-warnings/];

// SIGTERM is a POSIX fact. Windows cannot deliver one to a child, so the signal door
// is asserted only where that door exists. The message door exists on both platforms,
// so it is asserted on both. Skipping the signal test on Windows is the honest thing;
// running only the signal test would leave the message door uncovered everywhere.
const itOnPosix = it.skipIf(process.platform === 'win32');

// Everything the runtime printed to stderr that is not a known benign warning. A clean
// shutdown says nothing at all.
function stderrNoise(server: ServerProcess): string[] {
  return server.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !BENIGN_STDERR.some((pattern) => pattern.test(line)));
}

describe('EkoLite boots end to end', () => {
  let server: ServerProcess | null = null;
  let port: number;
  let bootCount = 0;

  async function startServerAsync(): Promise<ServerProcess> {
    port = await freePort();
    bootCount += 1;
    const started = new ServerProcess({
      readyString: READY_MESSAGE,
      env: {
        EKOLITE_PORT: String(port),
        EKOLITE_MONGO_DB: `ekolite_smoke_${String(process.pid)}_${String(bootCount)}`,
      },
    });
    server = started;
    await started.startAsync();
    return started;
  }

  // Guarded: a test that fails before it spawns anything should report its own failure,
  // not a TypeError from the teardown standing on top of it.
  afterEach(async () => {
    if (server !== null) {
      await server.stopAsync();
      server = null;
    }
  });

  it('spawns the real entry point and serves the home page', async () => {
    const started = await startServerAsync();

    expect(started.stdout).toContain(READY_MESSAGE);

    // start.ts binds 0.0.0.0, the IPv4 wildcard, so 127.0.0.1 is the address it is
    // actually listening on. `localhost` is a name, and what it resolves to is the
    // resolver's business: on Windows it answers ::1 first, where nothing is bound.
    // A slow, once-per-run test should not be able to fail over a DNS preference. If we
    // ever want `localhost` itself to be part of the claim, start.ts should bind `::`
    // and that is a change to the server, not to this line.
    const response = await fetch(`http://127.0.0.1:${String(port)}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(HOME_PAGE_MARKER);
  });

  // The door a supervisor can always reach. On Windows it is the only one: no parent
  // process can deliver a signal to a child, so a shutdown message over the IPC channel
  // is how PM2 and friends stop a node server there. It works on POSIX too, which is why
  // this test is not skipped anywhere.
  //
  // stopWithMessageAsync must send the message and nothing else. If it ever falls back to
  // a signal when the message goes unanswered, this test passes on POSIX whether or not
  // the message door works, and the only platform it actually covers is the one that
  // cannot run it. A server that ignores the message must hang here and fail.
  it('shuts down cleanly when a supervisor sends a shutdown message', async () => {
    const started = await startServerAsync();

    const result = await started.stopWithMessageAsync();

    expect(result).toEqual({ exitCode: 0, signal: null });
    expect(stderrNoise(started)).toEqual([]);
  });

  // The door Docker and systemd knock on. It exists only on POSIX, and the message test
  // can never exercise it, so it gets its own test rather than sharing one.
  itOnPosix('shuts down cleanly on SIGTERM', async () => {
    const started = await startServerAsync();

    const result = await started.stopWithSignalAsync();

    expect(result).toEqual({ exitCode: 0, signal: null });
    expect(stderrNoise(started)).toEqual([]);
  });
});
