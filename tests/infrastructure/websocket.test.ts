import { describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { webSocketContract } from './webSocketContract.ts';

describe('WebSocketWrapper (null)', () => {
  // Same behaviour the two real sources are held to in the integration suite, with
  // simulated clients in place of sockets.
  webSocketContract(() => {
    const ws = WebSocketWrapper.createNull();
    return Promise.resolve({
      ws,
      connect: () => {
        const client = ws.simulateConnection();
        return Promise.resolve({
          get messages() {
            return client.messages;
          },
          send: (message: unknown) => {
            client.send(message);
          },
          close: () => {
            client.close();
            return Promise.resolve();
          },
        });
      },
      close: () => ws.close(),
    });
  });

  it('tracks connection with nullable websocket', async () => {
    const ws = WebSocketWrapper.createNull();
    await createServer({ ws });

    const client = ws.simulateConnection();

    expect(ws.clientCount).toBe(1);

    client.close();

    expect(ws.clientCount).toBe(0);
  });
});
