import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

// A React component subscribes from its mount effect, which fires while the
// socket is still CONNECTING at cold load and during every reconnect gap. So
// subscribing before the socket is open must be safe: no throw, and the frame
// waits for the connection rather than being pushed at a socket that cannot
// take it.
describe('ConnectionManager — subscribing before the socket opens', () => {
  it('holds the subscribe frame until the socket opens, then sends it once and delivers', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const server = socket.simulateServer();

    // Subscribing before the connection is up must not throw and must return a
    // usable handle.
    const handle = manager.subscribe('files.all');
    expect(manager.activeSubscriptionCount()).toBe(1);

    // Nothing goes on the wire while the socket is still CONNECTING; the
    // subscription is held, waiting for the socket to open.
    expect(messages.data).toHaveLength(0);

    await socket.connect();

    // On open the held subscription is replayed exactly once, with its id and
    // name intact.
    expect(messages.data).toHaveLength(1);
    const sent = messages.data[0] as SubscribeMsg;
    expect(sent.type).toBe('subscribe');
    expect(sent.name).toBe('files.all');

    server.send({ type: 'added', collection: 'files', id: '1', fields: { name: 'existing.bam' } });
    server.send({ type: 'ready', id: sent.id, collection: 'files' });
    await handle.ready;

    expect(manager.store('files').getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
  });

  it('stopping a subscription made before open sends no unsubscribe and cleans up', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();

    const handle = manager.subscribe('files.all');
    handle.stop();

    // The subscription never reached the socket, so there is nothing to
    // unsubscribe: no frame is sent, and none is pushed at the connecting
    // socket. ready settles as a rejection and the bookkeeping is released.
    expect(messages.data).toHaveLength(0);
    expect(manager.activeSubscriptionCount()).toBe(0);
    await expect(handle.ready).rejects.toThrow('subscription stopped before ready');

    // When the socket finally opens, the stopped subscription is not replayed.
    await socket.connect();
    expect(messages.data).toHaveLength(0);
  });
});
