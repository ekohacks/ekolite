import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
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

describe('ClientSocket auth', () => {
  const PORT = 9878;
  let rawServer: WebSocketServer;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      rawServer.close(() => {
        resolve();
      });
    });
  });

  function createAuthServer(): WebSocketServer {
    return new WebSocketServer({
      port: PORT,
      verifyClient: (info, cb) => {
        const token = info.req.headers['authorization'];
        if (!token) {
          cb(false, 401, 'Unauthorized');
          return;
        }
        cb(true);
      },
    });
  }

  it('rejects connections without an auth token', async () => {
    rawServer = createAuthServer();
    const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {});
    await expect(client.connect()).rejects.toThrow();
  });

  it('connects when a valid auth header is provided', async () => {
    rawServer = createAuthServer();
    const client = ClientSocket.create(`ws://localhost:${String(PORT)}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await client.connect();
    expect(client.isConnected).toBe(true);
    await client.close();
  });
});
