import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('WebSocketWrapper via Fastify (real)', () => {
  const PORT = 9877;
  let ws: WebSocketWrapper;

  afterEach(async () => {
    await ws.close();
  });

  it('tracks connected clients', async () => {
    const fastify = Fastify();
    ws = WebSocketWrapper.create(fastify);
    await ws.start();
    await fastify.listen({ port: PORT });
    expect(ws.clientCount).toBe(0);

    const client = new WebSocket(`ws://localhost:${String(PORT)}/ws`);
    await new Promise((resolve) => client.on('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.clientCount).toBe(1);

    client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ws.clientCount).toBe(0);
  });

  it('broadcasts a message to all clients', async () => {
    const fastify = Fastify();
    ws = WebSocketWrapper.create(fastify);
    await ws.start();
    await fastify.listen({ port: PORT });

    const client1 = new WebSocket(`ws://localhost:${String(PORT)}/ws`);
    const client2 = new WebSocket(`ws://localhost:${String(PORT)}/ws`);
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
