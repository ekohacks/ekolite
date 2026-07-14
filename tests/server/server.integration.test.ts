import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('Server', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  afterEach(async () => {
    await server.close();
  });

  it('GET / returns 200 text/html', async () => {
    const ws = WebSocketWrapper.createRawWs({ port: 0 });
    server = await createServer({ ws });

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });
});
describe('Websocket fastify integration test', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let client: WebSocket;

  afterEach(async () => {
    client.close();
    await server.close();
  });
  it('accepts Websocket connection on /ws', async () => {
    const ws = WebSocketWrapper.create();
    server = await createServer({ ws });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    client = new WebSocket(`ws://localhost:${port}/ws`);

    await new Promise((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  // The nullable test proves createServer routes a ping. This proves the whole transport
  // does it: a real socket, a real frame on the wire, a real pong coming back. It is the
  // path ClientSocketWrapper's Heartbeat actually takes, and until the server answered it,
  // a client with the heartbeat switched on closed a healthy connection on its own.
  it('answers a ping over a real socket with a pong', async () => {
    const ws = WebSocketWrapper.create();
    server = await createServer({ ws });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    client = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    const pong = new Promise((resolve) => {
      client.on('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()));
      });
    });
    client.send(JSON.stringify({ type: 'ping', id: 'p1' }));

    await expect(pong).resolves.toEqual({ type: 'pong', id: 'p1' });
  });
});
