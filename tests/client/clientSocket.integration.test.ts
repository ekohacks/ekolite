import { afterEach, describe, expect, it } from 'vitest';
import { ClientSocket } from '../../client/clientSocket.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('ClientSocket (real)', () => {
  const PORT = 9877;
  let webSocketServer: WebSocketWrapper;
  let client: ClientSocket;

  afterEach(async () => {
    await client.close();
    await webSocketServer.close();
  });

  it('connects to a real server', async () => {
    webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
    await webSocketServer.start();
    client = ClientSocket.create('ws://localhost:9877');
    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(webSocketServer.clientCount).toBe(1);
  });
});
