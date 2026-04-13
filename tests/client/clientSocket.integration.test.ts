import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ClientSocket } from '../../client/clientSocket.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { createServer } from '../../server/index.ts';

describe('ClientSocket (real)', () => {
  const PORT = 9877;
  let webSocketServer: WebSocketWrapper;
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeEach(async () => {
    server = await createServer();
  });

  afterEach(async () => {
    // await webSocketServer.close();
    await server.close();
  });

  it('connects to a real server', async () => {
    webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
    await webSocketServer.start();
    const client = ClientSocket.create('ws://localhost:9877');
    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(webSocketServer.clientCount).toBe(1);
  });
});
