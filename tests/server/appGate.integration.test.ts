import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { App } from '../../server/app.ts';
import { defineDemo } from '../../server/demo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { type StoredFile } from '../../shared/types.ts';

// 7.B.2 — the gate. connect -> subscribe -> see the file -> analyse -> get the
// result, over a real socket, driven off App.createNull.
//
// This is the reactive pipeline the framework exists to prove, but assembled by
// App rather than by hand. The data infrastructure is Nulled (no Mongo, no python)
// while the socket, server and client are real, so a failure here is an App wiring
// bug, not a subsystem one. Nulled Mongo answers two finds: the subscribe that
// fills the store, then runCountC's locate. The HTTP upload half is proven
// separately in fileUpload.integration.test.ts.
const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for the reactive count to arrive');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('the gate: the full pipeline runs through App over a real socket', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let socket: ClientSocketWrapper;

  afterEach(async () => {
    await socket.close();
    await server.close();
  });

  it('a client subscribes, calls runCountC, and the count streams back into the store', async () => {
    const file: StoredFile = {
      _id: 'f1',
      name: 'reads.bam',
      path: '/data/reads.bam',
      size: 9,
      extension: 'bam',
      uploadedAt: new Date(),
    };
    const app = App.createNull({
      scriptResponses: { python3: '7' },
      findResponses: [[file], [file]],
      ws: WebSocketWrapper.create(),
    });
    // The app no longer arrives with files.all and runCountC on it, so the gate asks for
    // them the same way start.ts does. This is the point of 8.E: what the demo needs, the
    // demo says.
    defineDemo(app);

    server = await createServer(app);
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    socket = ClientSocketWrapper.create(`ws://localhost:${port}/ws`);
    await socket.connect();
    const manager = new ConnectionManager(socket);
    const handle = manager.subscribe('files.all');
    await handle.ready;

    const store = manager.store('files');
    expect(store.getById('f1')).toMatchObject({ _id: 'f1', name: 'reads.bam' });

    const count = await manager.call('runCountC', 'f1');
    expect(count).toBe(7);

    await waitFor(() => (store.getById('f1') as { countC?: number } | undefined)?.countC === 7);
    expect((store.getById('f1') as { countC?: number }).countC).toBe(7);
  });
});
