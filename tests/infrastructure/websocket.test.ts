import { describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('WebSocketWrapper (null)', () => {
  it('fires onConnection when a client connects', () => {
    const ws = WebSocketWrapper.createNull();
    const tracker = ws.trackConnections();
    ws.simulateConnection();
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toHaveProperty('clientId');
  });

  it('fires onDisconnection when a client disconnects', () => {
    const ws = WebSocketWrapper.createNull();
    const tracker = ws.trackDisconnections();
    const client = ws.simulateConnection();
    client.close();
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toHaveProperty('clientId');
  });

  it('tracks connected clients', () => {
    const ws = WebSocketWrapper.createNull();
    expect(ws.clientCount).toBe(0);
    const client = ws.simulateConnection();
    expect(ws.clientCount).toBe(1);
    client.close();
    expect(ws.clientCount).toBe(0);
  });

  it('tracks messages from clients', () => {
    const ws = WebSocketWrapper.createNull();
    const tracker = ws.trackMessages();
    const client = ws.simulateConnection();
    client.send({ type: 'ping' });
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({
      clientId: client.id,
      message: { type: 'ping' },
    });
  });

  it('sends a message to a specific client', () => {
    const ws = WebSocketWrapper.createNull();
    const client1 = ws.simulateConnection();
    const client2 = ws.simulateConnection();
    ws.send(client1.id, { type: 'hello' });
    expect(client1.messages).toEqual([{ type: 'hello' }]);
    expect(client2.messages).toEqual([]);
  });

  it('broadcasts a message to all clients', () => {
    const ws = WebSocketWrapper.createNull();
    const client1 = ws.simulateConnection();
    const client2 = ws.simulateConnection();
    ws.broadcast({ type: 'update', payload: 'refresh' });
    expect(client1.messages).toEqual([{ type: 'update', payload: 'refresh' }]);
    expect(client2.messages).toEqual([{ type: 'update', payload: 'refresh' }]);
  });
  it('it tracks connection with nullable websocket', async () => {
    const ws = WebSocketWrapper.createNull();
    await createServer({ ws });

    const client = ws.simulateConnection();

    expect(ws.clientCount).toBe(1);

    client.close();

    expect(ws.clientCount).toBe(0);
  });
});
