import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('ClientSocketWrapper (real)', () => {
  const PORT = 9877;
  let webSocketServer: WebSocketWrapper;
  let client: ClientSocketWrapper;

  afterEach(async () => {
    await client.close();
    await webSocketServer.close();
  });

  it('connects to a real server', async () => {
    webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
    await webSocketServer.start();
    client = ClientSocketWrapper.create(`ws://localhost:${String(PORT)}`);
    await client.connect();
    expect(client.isConnected).toBe(true);
    expect(webSocketServer.clientCount).toBe(1);
  });
});

describe('ClientSocketWrapper connect settles once', () => {
  const PORT = 9879;
  let webSocketServer: WebSocketWrapper;

  afterEach(async () => {
    await webSocketServer.close();
  });

  it('ignores onerror after onopen has already resolved', async () => {
    webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
    await webSocketServer.start();
    const client = ClientSocketWrapper.create(`ws://localhost:${String(PORT)}`);

    await client.connect();
    expect(client.isConnected).toBe(true);

    await client.close();
  });

  it('rejects once when server is not running', async () => {
    webSocketServer = WebSocketWrapper.createRawWs({ port: PORT });
    await webSocketServer.start();
    await webSocketServer.close();

    const client = ClientSocketWrapper.create(`ws://localhost:${String(PORT)}`);
    await expect(client.connect()).rejects.toThrow();
  });
});

describe('ClientSocketWrapper auth', () => {
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
        const url = new URL(info.req.url ?? '', `http://localhost:${String(PORT)}`);
        const token = url.searchParams.get('token');
        if (!token) {
          cb(false, 401, 'Unauthorized');
          return;
        }
        cb(true);
      },
    });
  }

  it('rejects connections without a token', async () => {
    rawServer = createAuthServer();
    const client = ClientSocketWrapper.create(`ws://localhost:${String(PORT)}`);
    await expect(client.connect()).rejects.toThrow();
  });

  it('connects when a valid token is provided', async () => {
    rawServer = createAuthServer();
    const client = ClientSocketWrapper.create(`ws://localhost:${String(PORT)}`, {
      token: 'test-token',
    });
    await client.connect();
    expect(client.isConnected).toBe(true);
    await client.close();
  });
});
