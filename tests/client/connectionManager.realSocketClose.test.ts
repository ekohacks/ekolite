import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';

describe('ConnectionManager with a real socket', () => {
  it('survives the server closing the socket, and disposes on its own deliberate close', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = (server.address() as { port: number }).port;

    // Reconnect off: with it on, the client would reopen against the still
    // running server and hold the process alive past server.close().
    const socket = ClientSocketWrapper.create(`ws://localhost:${String(port)}`, undefined, {
      reconnect: false,
    });
    await socket.connect();
    const manager = new ConnectionManager(socket);

    const handle = manager.subscribe('files.all');

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    for (const client of server.clients) {
      client.close();
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(manager.activeSubscriptionCount()).toBe(1);

    await socket.close();

    await expect(handle.ready).rejects.toThrow('subscription stopped before ready');
    expect(manager.activeSubscriptionCount()).toBe(0);

    server.close();
  });
});
