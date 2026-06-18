import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { Publications } from '../../server/logic/publications.ts';

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
});
