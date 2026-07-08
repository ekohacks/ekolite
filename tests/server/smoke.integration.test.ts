import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerProcess } from '../helpers/serverProcess.ts';
import { READY_MESSAGE } from '../../shared/serverMessages.ts';

// The one test that bypasses every Null and drives the real entry point. It spawns
// server/start.ts as a child process and waits for it to announce readiness on stdout.
// Later steps fetch the home page and ask it to shut down cleanly. If start.ts ever
// stops wiring Mongo, Fastify, the websocket, publications and files together, this is
// the test that catches it, because nothing else looks at the wiring.
//
// Integration only: it needs a real port and a real MongoDB (see AGENTS.md), so it
// lives in the integration config and runs under `npm run test:integration`.

// The home page is served from dist/client, so this asserts the built client is wired
// to `/`. The marker lives in client/index.html and survives the vite build.
const HOME_PAGE_MARKER = '<!-- ekolite home page -->';

// Lines the runtime may print to stderr that are noise, not a wiring fault. Empty in
// practice today; this is the seam to widen if a future node or tsx prints a warning.
const BENIGN_STDERR: RegExp[] = [/ExperimentalWarning/, /--trace-warnings/];

// A fresh ephemeral port per run, so the smoke test never collides with the default
// 3001 that `npm run dev:server` binds.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not reserve a free port'));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

describe('EkoLite boots end to end', () => {
  let server: ServerProcess;

  afterEach(async () => {
    await server.stopAsync();
  });

  it('spawns the real entry point, serves the home page, and shuts down cleanly', async () => {
    const port = await freePort();
    server = new ServerProcess({
      readyString: READY_MESSAGE,
      env: {
        EKOLITE_PORT: String(port),
        EKOLITE_MONGO_DB: `ekolite_smoke_${String(process.pid)}`,
      },
    });

    await server.startAsync();
    expect(server.stdout).toContain(READY_MESSAGE);

    const response = await fetch(`http://localhost:${String(port)}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(HOME_PAGE_MARKER);

    const result = await server.stopAsync();
    expect(result).toEqual({ exitCode: 0, signal: null });

    const noise = server.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !BENIGN_STDERR.some((pattern) => pattern.test(line)));
    expect(noise).toEqual([]);
  });
});
