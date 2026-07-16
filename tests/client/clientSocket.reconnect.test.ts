import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ServerMessage } from '../../shared/protocol.ts';

describe('ClientSocketWrapper - the socket comes back', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reopens after an unexpected close', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(50);

    expect(socket.isConnected).toBe(true);
  });

  it('delivers messages arriving over the reopened socket to existing listeners', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();
    const received: ServerMessage[] = [];
    socket.onMessage((message) => received.push(message));

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(50);
    expect(socket.isConnected).toBe(true);
    socket.simulateServer().send({ type: 'ready', id: '1', collection: 'files' });

    expect(received).toEqual([{ type: 'ready', id: '1', collection: 'files' }]);
  });

  it('reopens again when the replacement socket also dies', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(50);
    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(50);

    expect(socket.isConnected).toBe(true);
  });

  it('stays closed after a deliberate close()', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    await socket.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.isConnected).toBe(false);
  });

  it('cancels a pending reconnect when close() lands in the retry gap', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    socket.simulateServer().simulateClose();
    await socket.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.isConnected).toBe(false);
  });

  it('never reopens when the application opts out of reconnect', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull({ reconnect: false });
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(socket.isConnected).toBe(false);
  });
});
