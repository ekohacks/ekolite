import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { Publications } from '../../server/logic/publications.ts';
import { RpcHandler } from '../../server/logic/rpcHandler.ts';
import { Methods } from '../../server/logic/methods.ts';

// Tighter red for wires 2 and 3 only, with no real socket in sight. Everything is
// nulled: a null ws lets us simulate a connection and an inbound subscribe, a null
// mongo hands back a fixed document. The seam under test is purely 'does createServer
// route an inbound message into the pub/sub engine and send the reply back out'.
//
// Red today because:
//   - ServerOptions is { ws }, so { ws, publications } is rejected (wire 2), and
//   - nothing in createServer pumps ws inbound messages into publications.handleMessage,
//     so the stubbed client hears nothing back (wire 3).
//
// It says nothing about the real Fastify socket: the null path already forwards
// inbound frames, so this test passes straight through that seam. The real-socket
// gap is rung 2's job. Keeping them apart is the whole point of tighter reds.

describe('createServer routes inbound subscriptions into publications', () => {
  it('a simulated subscribe yields added + ready back to the client', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const publications = new Publications(mongo, ws);
    publications.define('files.all', () => ({ collection: 'files', query: {} }));

    await createServer({ ws, publications });

    const client = ws.simulateConnection();
    client.send({ type: 'subscribe', id: 'sub1', name: 'files.all' });

    await vi.waitFor(() => {
      expect(client.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'added', id: '1', fields: { name: 'existing.bam' } }),
          expect.objectContaining({ type: 'ready', id: 'sub1', collection: 'files' }),
        ]),
      );
    });
  });

  // The heartbeat lives in the transport, not in a feature. A socket with no publications
  // and no methods on it still has to prove it is alive, so the pong cannot be gated on
  // either being configured. Red today: createServer only registers an onMessage handler
  // when publications or an rpcHandler is passed, and its switch drops 'ping' on default.
  it('answers a ping with a pong, with no publications or methods configured', async () => {
    const ws = WebSocketWrapper.createNull();

    await createServer({ ws });

    const client = ws.simulateConnection();
    client.send({ type: 'ping' });

    await vi.waitFor(() => {
      expect(client.messages).toContainEqual({ type: 'pong' });
    });
  });

  // ClientSocketWrapper's Heartbeat sends a bare ping today, but PingMsg carries an
  // optional id, so a pong has to carry it back or a client that correlates its pings
  // cannot tell which one came home.
  it('echoes the ping id back on the pong', async () => {
    const ws = WebSocketWrapper.createNull();

    await createServer({ ws });

    const client = ws.simulateConnection();
    client.send({ type: 'ping', id: 'p1' });

    await vi.waitFor(() => {
      expect(client.messages).toContainEqual({ type: 'pong', id: 'p1' });
    });
  });

  it('routes method messages to the rpc handler and returns results to the same client', async () => {
    const ws = WebSocketWrapper.createNull();
    const methods = new Methods();
    methods.define('echo', (msg) => Promise.resolve(`echo: ${String(msg)}`));
    const rpcHandler = new RpcHandler(methods, ws);

    await createServer({ ws, rpcHandler });

    const client = ws.simulateConnection();
    client.send({ type: 'method', id: 'm1', name: 'echo', params: ['hello'] });

    await vi.waitFor(() => {
      expect(client.messages).toContainEqual({
        type: 'result',
        id: 'm1',
        result: 'echo: hello',
      });
    });
  });
});

// The static root is the caller's decision, not EkoLite's. createServer used to hardcode
// its own demo directory, which meant a consumer could only ever serve our demo, and only
// from the source layout where that path happened to resolve. These pin the two halves of
// the new contract: a root the caller passes is served, and no root serves nothing rather
// than silently 404ing while looking configured.
describe('createServer serves the static root the caller chooses', () => {
  let server: Awaited<ReturnType<typeof createServer>> | null = null;
  let clientDir: string;

  beforeEach(() => {
    clientDir = mkdtempSync(join(tmpdir(), 'ekolite-static-'));
    writeFileSync(join(clientDir, 'index.html'), '<!-- a consumer page -->');
  });

  afterEach(async () => {
    if (server !== null) {
      await server.close();
      server = null;
    }
    rmSync(clientDir, { recursive: true, force: true });
  });

  it('serves files from the staticRoot it was given', async () => {
    const ws = WebSocketWrapper.createNull();
    server = await createServer({ ws, staticRoot: clientDir });

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<!-- a consumer page -->');
  });

  it('serves nothing when no staticRoot is configured', async () => {
    const ws = WebSocketWrapper.createNull();
    server = await createServer({ ws });

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(404);
  });
});
