import { describe } from 'vitest';
import Fastify from 'fastify';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { webSocketContract } from './webSocketContract.ts';
import { realClient } from './websocket.integration.test.ts';

// Narrow integration test: the Fastify source, the one production uses, over a real
// socket at /ws. The behaviour is the contract list the unit file runs on the null.
describe('WebSocketWrapper (real, via Fastify)', () => {
  webSocketContract(async () => {
    const fastify = Fastify();
    const ws = WebSocketWrapper.create();
    await ws.attach(fastify);
    await fastify.listen({ port: 0 });
    const port = String(fastify.addresses()[0].port);
    return {
      ws,
      connect: () => realClient(`ws://localhost:${port}/ws`),
      close: async () => {
        ws.dropAllClients();
        await ws.close();
      },
    };
  });
});
