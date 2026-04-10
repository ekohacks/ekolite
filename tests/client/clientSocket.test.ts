import { describe, expect, it } from 'vitest';
import { ClientSocket } from '../../client/clientSocket.ts';
import { ReadyMsg, UnsubscribeMsg } from '../../shared/protocol.ts';

describe('ClientSocket (null)', () => {
  it('is not connected before connect is called', () => {
    const socket = ClientSocket.createNull();
    expect(socket.isConnected).toBe(false);
  });
  it('is connected after connect is called', async () => {
    const socket = ClientSocket.createNull();

    await socket.connect();

    expect(socket.isConnected).toBe(true);
  });
  it('is not connected after close is called', async () => {
    const socket = ClientSocket.createNull();

    await socket.connect();
    await socket.close();

    expect(socket.isConnected).toBe(false);
  });
  it('can recieve a message from the server', async () => {
    const message: ReadyMsg = { type: 'ready', id: '1' };
    const socket = ClientSocket.createNull();
    const tracker = socket.trackMessages();
    await socket.connect();
    const server = socket.simulateServer();
    server.send(message);
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({ type: 'ready', id: '1' });
  });
  it('can send a message to the server', async () => {
    const message: UnsubscribeMsg = { type: 'unsubscribe', id: '1' };

    const socket = ClientSocket.createNull();
    const tracker = socket.trackMessages();
    await socket.connect();
    await socket.send(message);
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toEqual({ type: 'unsubscribe', id: '1' });
  });
});
