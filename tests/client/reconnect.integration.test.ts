import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { Publications } from '../../server/logic/publications.ts';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';

const withReadyTimeout = <T>(promise: Promise<T>): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => {
        reject(new Error('subscription never became ready'));
      }, 1000),
    ),
  ]);
};

// The shape this red demands: the server can kick its clients while staying
// up, which is what a mid flight network death looks like from the client.
const dropAllClients = (ws: WebSocketWrapper): void => {
  (ws as unknown as { dropAllClients(): void }).dropAllClients();
};

describe('reconnect and resubscribe over a real server', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let socket: ClientSocketWrapper;

  afterEach(async () => {
    await socket.close();
    await server.close();
  });

  it('a dropped client comes back, resubscribes with the same id, and its store catches up', async () => {
    // One canned response per find call: the initial subscribe sees doc 1,
    // the resubscribe sees the new truth. A publication registered twice
    // would exhaust the queue and fail loudly.
    const mongo = MongoWrapper.createNull({
      find: [
        [{ _id: '1', name: 'existing.bam' }],
        [
          { _id: '1', name: 'existing.bam' },
          { _id: '2', name: 'fresh.bam' },
        ],
      ],
    });
    const ws = WebSocketWrapper.create();
    const publications = new Publications(mongo, ws);
    publications.define('files.all', () => ({ collection: 'files', query: {} }));

    server = await createServer({ ws, publications });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    socket = ClientSocketWrapper.create(`ws://localhost:${port}/ws`);
    await socket.connect();
    const manager = new ConnectionManager(socket);

    const handle = manager.subscribe('files.all');
    await withReadyTimeout(handle.ready);
    expect(manager.store('files').getAll()).toEqual([{ _id: '1', name: 'existing.bam' }]);

    dropAllClients(ws);

    await vi.waitFor(
      () => {
        expect(manager.store('files').getById('2')).toEqual({ _id: '2', name: 'fresh.bam' });
      },
      { timeout: 3000 },
    );
    expect(socket.status).toBe('connected');
    expect(manager.activeSubscriptionCount()).toBe(1);
  });
});
