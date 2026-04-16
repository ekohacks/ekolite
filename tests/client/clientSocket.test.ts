import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ReadyMsg, UnsubscribeMsg } from '../../shared/protocol.ts';

describe('ClientSocketWrapper URL validation', () => {
  it('rejects non-websocket URLs', () => {
    expect(() => ClientSocketWrapper.create('http://localhost:8080')).toThrow();
  });

  it('rejects URLs without a protocol', () => {
    expect(() => ClientSocketWrapper.create('localhost:8080')).toThrow();
  });

  it('accepts ws:// URLs', () => {
    expect(() => ClientSocketWrapper.create('ws://localhost:8080')).not.toThrow();
  });

  it('accepts wss:// URLs', () => {
    expect(() => ClientSocketWrapper.create('wss://localhost:8080')).not.toThrow();
  });
});

describe('ClientSocketWrapper (null)', () => {
  it('is not connected before connect is called', () => {
    const socket = ClientSocketWrapper.createNull();
    expect(socket.isConnected).toBe(false);
  });
  it('is connected after connect is called', async () => {
    const socket = ClientSocketWrapper.createNull();

    await socket.connect();

    expect(socket.isConnected).toBe(true);
  });
  it('is not connected after close is called', async () => {
    const socket = ClientSocketWrapper.createNull();

    await socket.connect();
    await socket.close();

    expect(socket.isConnected).toBe(false);
  });
  it('can receive a message from the server', async () => {
    const message: ReadyMsg = { type: 'ready', id: '1' };
    const socket = ClientSocketWrapper.createNull();
    const tracker = socket.trackMessages();
    await socket.connect();
    const server = socket.simulateServer();
    server.send(message);
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({ type: 'ready', id: '1' });
  });
  it('can send a message to the server', async () => {
    const message: UnsubscribeMsg = { type: 'unsubscribe', id: '1' };

    const socket = ClientSocketWrapper.createNull();
    const tracker = socket.trackMessages();
    await socket.connect();
    await socket.send(message);
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({ type: 'unsubscribe', id: '1' });
  });
});
