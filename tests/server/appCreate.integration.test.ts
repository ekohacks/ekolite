import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../../server/index.ts';
import { App } from '../../server/app.ts';

// 7.B.3 — App.create wires real infrastructure.
//
// The live boot, behind the class. App.create(config) builds the real Mongo, socket,
// storage and script runner, and createServer turns that into a Fastify server that
// serves the built client and speaks the websocket protocol. GET / and /ws touch
// neither Mongo nor python, so this runs without a database. app.close() is the
// graceful shutdown: it closes the socket (and with it the Fastify server) and the
// Mongo connection.
describe('App.create wires real infrastructure', () => {
  let app: App | undefined;
  let server: Awaited<ReturnType<typeof createServer>>;
  let client: WebSocket | undefined;

  afterEach(async () => {
    client?.close();
    client = undefined;
    // app.close() shuts the socket, which closes the Fastify server it attached to,
    // then the Mongo connection. One close for the whole graph. Guarded: if
    // App.create ever throws, app is still undefined here.
    await app?.close();
    app = undefined;
  });

  it('boots a server that serves the page and accepts websocket connections', async () => {
    app = App.create({
      mongoUri: 'mongodb://localhost:27017/ekolite-test',
      fileDir: './uploads',
      port: 0,
    });

    server = await createServer(app);
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const response = await server.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');

    client = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      client?.on('open', resolve);
      client?.on('error', reject);
    });

    expect(client.readyState).toBe(WebSocket.OPEN);
  });
});
