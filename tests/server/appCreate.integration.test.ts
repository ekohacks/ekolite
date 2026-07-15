import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../../server/index.ts';
import { App } from '../../server/app.ts';

// 7.B.3 — App.create wires real infrastructure.
//
// The live boot, behind the class. App.create(config) builds the real Mongo, socket,
// storage and script runner, and createServer attaches that to a Fastify server that
// speaks the websocket protocol. It asserts the socket and nothing else: serving a client
// is the caller's own business now, through staticRoot, and App.create carries no page of
// its own to serve. That static path is covered without the demo elsewhere (a temp fixture
// in createServerRouting, the real boot in smoke), so this test needs no build to have run.
// /ws touches neither Mongo nor python, so it runs without a database. app.close() is the
// graceful shutdown: it closes the socket (and with it the Fastify server) and Mongo.
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

  it('boots a server whose real socket accepts websocket connections', async () => {
    app = App.create({
      mongoUri: 'mongodb://localhost:27017/ekolite-test',
      fileDir: './uploads',
      port: 0,
    });

    server = await createServer(app);
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    client = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      client?.on('open', resolve);
      client?.on('error', reject);
    });

    expect(client.readyState).toBe(WebSocket.OPEN);
  });
});
