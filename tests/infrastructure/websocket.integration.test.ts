import { describe } from 'vitest';
import WebSocket from 'ws';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { freePort } from '../helpers/freePort.ts';
import { webSocketContract, type ContractClient } from './webSocketContract.ts';

// A real client over a real socket, in the shape the contract speaks.
export async function realClient(url: string): Promise<ContractClient> {
  const socket = new WebSocket(url);
  const messages: unknown[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse((data as Buffer).toString('utf-8')));
  });
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => {
      resolve();
    });
    socket.on('error', reject);
  });
  return {
    messages,
    send: (message: unknown) => {
      socket.send(JSON.stringify(message));
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        socket.once('close', () => {
          resolve();
        });
        socket.close();
      }),
  };
}

// Narrow integration test: the raw ws source over a real socket. The behaviour is the
// contract list the unit file runs on the null.
describe('WebSocketWrapper (real, raw ws)', () => {
  webSocketContract(async () => {
    const port = await freePort();
    const ws = WebSocketWrapper.createRawWs({ port });
    await ws.start();
    return {
      ws,
      connect: () => realClient(`ws://localhost:${String(port)}`),
      // The raw ws server's close waits for every client socket to end: drop them first.
      close: async () => {
        ws.dropAllClients();
        await ws.close();
      },
    };
  });
});
