import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';

describe('ConnectionManager with a real socket', () => {
  it('disposes when the server closes the socket', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = (server.address() as { port: number }).port;

    const socket = ClientSocketWrapper.create(`ws://localhost:${String(port)}`);
    await socket.connect();
    const manager = new ConnectionManager(socket);

    manager.subscribe('files.all');

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    for (const client of server.clients) {
      client.close();
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(manager.activeSubscriptionCount()).toBe(0);

    server.close();
  });
});
