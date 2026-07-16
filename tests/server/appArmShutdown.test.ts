import { describe, expect, it } from 'vitest';
import { App } from '../../server/app.ts';
import { ProcessWrapper } from '../../server/infrastructure/process.ts';

// EKO-308 — a consumer can arm graceful shutdown without reaching into the package.
//
// Shutdown policy (the deadline, the exit codes, the second-signal hard exit) is already
// proven against the Nulled process in tests/logic/shutdown.test.ts and is not repeated
// here. This is the reach: App.armShutdown() ties that policy to App's OWN close() and the
// process App holds, so `app.armShutdown()` is the whole of what a consumer writes and
// ProcessWrapper never leaves the package.
//
// App.create() holds ProcessWrapper.create(); App.createNull() holds a Nulled one, which
// the test injects so it can drive the request and watch the exit. Handing a real process
// to a unit test would call process.exit and take the runner down with it.

// Let the async close() run its disposers before asserting the exit, the same flush the
// Shutdown unit tests use.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('App.armShutdown', () => {
  it('arms graceful shutdown: a shutdown request closes the app and exits 0', async () => {
    const proc = ProcessWrapper.createNull();
    const app = App.createNull({ proc });
    const exits = proc.trackExits();

    app.armShutdown();
    proc.simulateShutdownRequest('SIGTERM');
    await flush();

    // A clean close is the only path to exit 0: Shutdown exits 1 on a reject or a timeout.
    // So this exit code alone proves armShutdown wired App.close() to the process.
    expect(exits.data).toEqual([{ code: 0 }]);
  });
});
