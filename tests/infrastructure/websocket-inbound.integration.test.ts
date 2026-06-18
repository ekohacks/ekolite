import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

// Tighter red for wire 1 only: the real Fastify socket must forward inbound client
// frames into the wrapper so the rest of the stack can act on them. Today
// FastifyConnectionSource wraps the socket with send/close/onClose and no onMessage,
// so anything a real client sends is dropped on the floor.
//
// This gap is invisible to the nullable tests: NullServerSocket already implements
// onMessage, so simulateConnection().send() forwards fine. Only a real socket
// exercises the missing wire, which is why this one has to be an integration test.

describe('WebSocketWrapper forwards inbound frames from a real socket', () => {
  let ws: WebSocketWrapper;
  let client: WebSocket;

  afterEach(async () => {
    client.close();
    await ws.close();
  });

  it('records a message the client sends over the wire', async () => {
    const fastify = Fastify();
    ws = WebSocketWrapper.create();
    await ws.attach(fastify);
    await fastify.listen({ port: 0 });
    const port = String(fastify.addresses()[0].port);

    const inbound = ws.trackMessages();

    client = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
    });

    client.send(JSON.stringify({ type: 'subscribe', id: 's1', name: 'files.all' }));

    await vi.waitFor(() => {
      expect(inbound.data.length).toBeGreaterThan(0);
    });
  });
});
