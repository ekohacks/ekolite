import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { ScriptRunnerWrapper } from '../../server/infrastructure/scriptRunner.ts';
import { Publications } from '../../server/logic/publications.ts';
import { RpcHandler } from '../../server/logic/rpcHandler.ts';
import { Methods } from '../../server/logic/methods.ts';
import { Files } from '../../server/logic/files.ts';
import { defineRunCountC } from '../../server/logic/analysis.ts';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';

// The whole point of the arc, proven over a real socket: a client calls runCountC
// on an uploaded file, the server counts and writes the count onto the file's
// document, and the change streams back into the client's reactive store through the
// same files.all subscription. Nulled Mongo and runner so it needs no database or
// python; the socket, server, and client are real.
const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for the reactive count to arrive');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('runCountC over a real socket, the count arrives reactively', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let socket: ClientSocketWrapper;

  afterEach(async () => {
    await socket.close();
    await server.close();
  });

  it('a client call runs the analysis and streams the count back into the store', async () => {
    const storedFile = {
      _id: 'f1',
      name: 'reads.bam',
      path: '/data/reads.bam',
      size: 9,
      extension: 'bam',
      uploadedAt: new Date(),
    };
    // First find fills the subscription; second answers runCountC's locate.
    const mongo = MongoWrapper.createNull({ find: [[storedFile], [storedFile]] });
    const storage = FileStorageWrapper.createNull();
    const runner = ScriptRunnerWrapper.createNull({ python3: '3\n' });
    const ws = WebSocketWrapper.create();
    const methods = new Methods();
    const files = new Files(mongo, storage);
    defineRunCountC(methods, runner, files, 'scripts/countC.py');
    const rpcHandler = new RpcHandler(methods, ws);
    const publications = new Publications(mongo, ws);
    publications.define('files.all', () => ({ collection: 'files', query: {} }));

    server = await createServer({ ws, publications, rpcHandler, files });
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
    expect(count).toBe(3);

    await waitFor(() => (store.getById('f1') as { countC?: number } | undefined)?.countC === 3);
    expect((store.getById('f1') as { countC?: number }).countC).toBe(3);
  });
});
