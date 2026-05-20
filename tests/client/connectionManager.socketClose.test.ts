import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

describe('ConnectionManager - after socket dies', () => {
  it('disposes when the socket closes, without an explicit dispose call', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();

    const handle = manager.subscribe('files.all');
    server.send({ type: 'ready', id: (messages.data[0] as SubscribeMsg).id });
    await handle.ready;

    await socket.close();

    expect(manager.activeSubscriptionCount()).toBe(0);
  });
});
