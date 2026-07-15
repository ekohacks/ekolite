import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { App } from '../../server/app.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { ClientSocketWrapper } from '../../client/index.ts';
import { ConnectionManager } from '../../client/index.ts';
import { type StoredFile } from '../../shared/types.ts';

// The gate: the full reactive loop runs through App over a real socket. A client
// subscribes, sees the seeded document, calls a method that mutates it, and the change
// streams back into the client's store on its own. livePubsub proves the subscribe-and-
// fill half; this proves the other half, the live update after a method writes.
//
// The app defines its own publication and method here, the way a developer's app would,
// since App carries none of its own. The data infrastructure is Nulled (no Mongo) while
// the socket, server and client are real, so a failure is an App wiring bug, not a
// subsystem one. Nulled Mongo answers one find, the subscribe that fills the store; the
// method's $set write streams back through the same files.all publication.
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

  it('a client subscribes, calls a method that mutates a doc, and the change streams back', async () => {
    const file: StoredFile = {
      _id: 'f1',
      name: 'reads.bam',
      path: '/data/reads.bam',
      size: 9,
      extension: 'bam',
      uploadedAt: new Date(),
    };
    const app = App.createNull({
      findResponses: [[file]],
      ws: WebSocketWrapper.create(),
    });
    // The app defines its own surface: a publication to subscribe to, and a method that
    // writes a value back onto the document so it streams to subscribers.
    app.publications.define('files.all', () => ({ collection: 'files', query: {} }));
    app.methods.define('recordCount', (fileId, count) =>
      app.files.recordCountC(fileId as string, count as number).then(() => count),
    );

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

    const count = await manager.call('recordCount', 'f1', 7);
    expect(count).toBe(7);

    await waitFor(() => (store.getById('f1') as { countC?: number } | undefined)?.countC === 7);
    expect((store.getById('f1') as { countC?: number }).countC).toBe(7);
  });
});
