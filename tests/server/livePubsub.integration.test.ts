import { afterEach, describe, expect, it } from 'vitest';
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
        reject(
          new Error('subscription never became ready: the live socket is not wired end to end'),
        );
      }, 1000),
    ),
  ]);
};

describe('live pub/sub over a real socket', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let socket: ClientSocketWrapper;

  afterEach(async () => {
    await socket.close();
    await server.close();
  });

  it('a real client subscription fills its store from the server', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.create();
    const publications = new Publications(mongo, ws);
    publications.define('files.all', () => ({ collection: 'files', query: {} }));

    // Target API: the boot path hands its publications to the server so inbound
    // subscribes get routed to the engine. ServerOptions has to grow to accept this.
    server = await createServer({ ws, publications });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    socket = ClientSocketWrapper.create(`ws://localhost:${port}/ws`);
    await socket.connect();
    const manager = new ConnectionManager(socket);

    const handle = manager.subscribe('files.all');
    await withReadyTimeout(handle.ready);

    expect(manager.store('files').getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
  });
});
