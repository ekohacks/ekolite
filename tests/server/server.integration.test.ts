import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../../server/index.ts';

describe('Server', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  afterEach(async () => {
    await server.close();
  });

  it('GET / returns 200 text/html', async () => {
    server = await createServer();

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });
});
describe('Websocket fastify intergration test', () => {
  it('accepts Websocket connection on /ws', async () => {
    const server = await createServer();
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const ws = new WebSocket(`ws://localhost:${port}/ws`);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await server.close();
  });
});
