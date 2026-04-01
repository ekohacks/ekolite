import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('WebSocketWrapper (real)', () => {
  const PORT = 9876;
  let ws: WebSocketWrapper;

  afterEach(async () => {
    await ws.close();
  });

  it('tracks connected clients', async () => {
    ws = WebSocketWrapper.create({ port: PORT });
    await ws.start();
    expect(ws.clientCount).toBe(0);

    const client = new WebSocket(`ws://localhost:${String(PORT)}`);
    await new Promise((resolve) => client.on('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.clientCount).toBe(1);

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.clientCount).toBe(0);
  });

  it('broadcasts a message to all clients', async () => {
    ws = WebSocketWrapper.create({ port: PORT });
    await ws.start();

    const client1 = new WebSocket(`ws://localhost:${String(PORT)}`);
    const client2 = new WebSocket(`ws://localhost:${String(PORT)}`);
    await Promise.all([
      new Promise((resolve) => client1.on('open', resolve)),
      new Promise((resolve) => client2.on('open', resolve)),
    ]);

    const received1 = new Promise<unknown>((resolve) => {
      client1.on('message', (data) => {
        resolve(JSON.parse((data as Buffer).toString('utf-8')));
      });
    });
    const received2 = new Promise<unknown>((resolve) => {
      client2.on('message', (data) => {
        resolve(JSON.parse((data as Buffer).toString('utf-8')));
      });
    });

    ws.broadcast({ type: 'update', payload: 'refresh' });

    expect(await received1).toEqual({ type: 'update', payload: 'refresh' });
    expect(await received2).toEqual({ type: 'update', payload: 'refresh' });

    client1.close();
    client2.close();
  });
});
