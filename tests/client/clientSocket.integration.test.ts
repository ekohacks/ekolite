import { afterEach } from 'node:test';
import { describe, expect, it } from 'vitest';
import { ClientSocket } from '../../client/clientSocket.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('ClientSocket (real)', () => {
  const PORT = 9877;
  let server: WebSocketWrapper;

  afterEach(async () => {
    await server.close();
  });

  it('connects to a real server', async () => {
    server = WebSocketWrapper.createRawWs({ port: PORT });
    const client = ClientSocket.create('ws://localhost:9877');
    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(server.clientCount).toBe(1);
  });
});
