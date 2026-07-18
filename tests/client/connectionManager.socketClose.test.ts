import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

// Until this story, any close disposed the manager. Now the socket comes back
// on its own, so an unexpected close is something to survive, and only a
// deliberate close is the end.
describe('ConnectionManager - after the socket dies unexpectedly', () => {
  it('survives: subscriptions and stores are waiting for the socket to come back', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    await socket.connect();

    const handle = manager.subscribe('files.all');
    server.send({ type: 'ready', id: (messages.data[0] as SubscribeMsg).id, collection: 'files' });
    await handle.ready;

    server.simulateClose();

    expect(manager.activeSubscriptionCount()).toBe(1);
    expect(() => manager.store('files')).not.toThrow();
  });

  it('rejects a call in flight: its result died with the connection', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);

    const pending = manager.call('files.rename', 'a.bam');
    server.simulateClose();

    await expect(pending).rejects.toThrow('connection closed');
  });

  it('still disposes on a deliberate close', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    await socket.connect();

    await socket.close();

    expect(() => manager.store('files')).toThrow('ConnectionManager is disposed');
  });
});
