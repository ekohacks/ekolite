import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('WebSocketWrapper (real)', () => {
  const PORT = 9876;
  let ws: ReturnType<typeof WebSocketWrapper.create>;

  afterEach(async () => {
    await ws.close();
  });

  it('sends a message to a connected client', async () => {
    ws = WebSocketWrapper.create({ port: PORT });
    await ws.start();

    const client = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => client.on('open', resolve));

    const received = new Promise<unknown>((resolve) => {
      client.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    ws.broadcast({ type: 'greeting', payload: 'hello' });

    expect(await received).toEqual({ type: 'greeting', payload: 'hello' });
    client.close();
  });

  it('receives a message from a connected client', async () => {
    ws = WebSocketWrapper.create({ port: PORT });
    const received = new Promise<unknown>((resolve) => {
      ws.onMessage((_clientId, message) => resolve(message));
    });
    await ws.start();

    const client = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => client.on('open', resolve));

    client.send(JSON.stringify({ type: 'ping' }));

    expect(await received).toEqual({ type: 'ping' });
    client.close();
  });

  it('tracks connected clients', async () => {
    ws = WebSocketWrapper.create({ port: PORT });
    await ws.start();
    expect(ws.clientCount).toBe(0);

    const client = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => client.on('open', resolve));
    // small delay for server to register the connection
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.clientCount).toBe(1);

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.clientCount).toBe(0);
  });
});
