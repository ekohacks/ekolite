import { describe, it, expect } from 'vitest';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('WebSocketWrapper (null)', () => {
  it('sends a message to a connected client', async () => {
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    ws.send(client.id, { type: 'greeting', payload: 'hello' });
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]).toEqual({ type: 'greeting', payload: 'hello' });
  });

  it('receives a message from a connected client', async () => {
    const ws = WebSocketWrapper.createNull();
    const received: unknown[] = [];
    ws.onMessage((clientId, message) => {
      received.push({ clientId, message });
    });
    const client = ws.simulateConnection();
    client.send({ type: 'ping' });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      clientId: client.id,
      message: { type: 'ping' },
    });
  });

  it('tracks connected clients', async () => {
    const ws = WebSocketWrapper.createNull();
    expect(ws.clientCount).toBe(0);
    const client = ws.simulateConnection();
    expect(ws.clientCount).toBe(1);
    client.close();
    expect(ws.clientCount).toBe(0);
  });

  it('broadcasts a message to all connected clients', async () => {
    const ws = WebSocketWrapper.createNull();
    const client1 = ws.simulateConnection();
    const client2 = ws.simulateConnection();
    ws.broadcast({ type: 'update', payload: 'refresh' });
    expect(client1.messages).toHaveLength(1);
    expect(client2.messages).toHaveLength(1);
    expect(client1.messages[0]).toEqual({
      type: 'update',
      payload: 'refresh',
    });
  });

  it('fires a callback when a client connects', async () => {
    const ws = WebSocketWrapper.createNull();
    const connected: string[] = [];
    ws.onConnection((clientId) => {
      connected.push(clientId);
    });
    const client = ws.simulateConnection();
    expect(connected).toEqual([client.id]);
  });

  it('fires a callback when a client disconnects', async () => {
    const ws = WebSocketWrapper.createNull();
    const disconnected: string[] = [];
    ws.onDisconnection((clientId) => {
      disconnected.push(clientId);
    });
    const client = ws.simulateConnection();
    client.close();
    expect(disconnected).toEqual([client.id]);
  });
});
