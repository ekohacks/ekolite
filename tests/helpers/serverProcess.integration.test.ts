import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerProcess } from './serverProcess.ts';
import { freePort } from './freePort.ts';
import { READY_MESSAGE } from '../../shared/serverMessages.ts';

// The harness's own tests. Not about whether EkoLite boots: about whether the harness can
// say why it did not.
//
// This file exists because it could not. A Windows run of the smoke test failed with
// `Test timed out in 5000ms` and nothing else. No stdout, no stderr, no exit code, no way
// to tell a server that never started from a server that started and was never heard. The
// harness had all of it and was killed mid-sentence by vitest's default budget, which was
// shorter than the harness's own ready timeout.
//
// Both branches of startAsync's failure are pinned below. If the timeout ordering in
// vitest.integration.config.ts is ever broken again, these two are the first to time out,
// and they time out saying nothing, which is the whole complaint.

const NEVER_PRINTED = 'a line that server/start.ts never prints';
const NEVER_PRINTED_TIMEOUT_MS = 1_500;

// Reject the resolve. A startAsync that succeeds where we expect it to fail must not be
// allowed to pass silently into the assertions below.
async function startAndCaptureErrorAsync(server: ServerProcess): Promise<Error> {
  try {
    await server.startAsync();
  } catch (error) {
    return error as Error;
  }
  throw new Error('startAsync resolved; expected it to reject');
}

// Occupy the exact wildcard start.ts binds (0.0.0.0). A bare listen(0) binds the IPv6
// wildcard instead, which only collides with the child's IPv4 bind on platforms where
// v6 sockets are dual-stack by default. Windows keeps them separate (IPV6_V6ONLY is on),
// so the "occupied" port was free on the v4 side and the child booted happily.
function listenAsync(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not occupy a port'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function closeAsync(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

describe('ServerProcess says why a server never became ready', () => {
  let server: ServerProcess | null = null;
  let occupied: net.Server | null = null;

  afterEach(async () => {
    if (server !== null) {
      await server.stopAsync();
      server = null;
    }
    if (occupied !== null) {
      await closeAsync(occupied);
      occupied = null;
    }
  });

  // The child dies on its own. Hold the port first, so start.ts cannot bind it and exits
  // before printing anything. Deterministic and fast: no timeout is involved on this path,
  // so it cannot race a slow machine.
  it('names the exit code and hands back stderr when the child dies before ready', async () => {
    const taken = await listenAsync();
    occupied = taken.server;

    server = new ServerProcess({
      readyString: READY_MESSAGE,
      env: {
        EKOLITE_PORT: String(taken.port),
        EKOLITE_MONGO_DB: `ekolite_harness_${String(process.pid)}`,
      },
    });

    const error = await startAndCaptureErrorAsync(server);

    expect(error.message).toContain('server exited before ready');
    expect(error.message).toContain('EADDRINUSE');
  });

  // The child lives and says nothing we recognise. This is the branch vitest was cutting
  // off. Only the shape of the message is asserted, never its stdout contents, so a slow
  // boot changes what the message carries but never whether the test passes.
  it('names the ready string, the timeout, and both streams when the line never arrives', async () => {
    const port = await freePort();

    server = new ServerProcess({
      readyString: NEVER_PRINTED,
      readyTimeoutMs: NEVER_PRINTED_TIMEOUT_MS,
      env: {
        EKOLITE_PORT: String(port),
        EKOLITE_MONGO_DB: `ekolite_harness_${String(process.pid)}`,
      },
    });

    const error = await startAndCaptureErrorAsync(server);

    expect(error.message).toContain(`did not print ${JSON.stringify(NEVER_PRINTED)}`);
    expect(error.message).toContain(`within ${String(NEVER_PRINTED_TIMEOUT_MS)}ms`);
    expect(error.message).toContain('stdout:');
    expect(error.message).toContain('stderr:');
  });
});
