import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';

describe('ClientSocketWrapper - a close carries intent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a deliberate close when the application calls close()', async () => {
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    const events: { deliberate: boolean }[] = [];
    socket.onClose((event: { deliberate: boolean }) => events.push(event));

    await socket.close();

    expect(events).toEqual([{ deliberate: true }]);
  });

  it('reports an unexpected close when the socket dies under the client', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    await socket.connect();

    const events: { deliberate: boolean }[] = [];
    socket.onClose((event: { deliberate: boolean }) => events.push(event));

    server.simulateClose();

    expect(events).toEqual([{ deliberate: false }]);
  });

  it('counts the heartbeat closing a dead connection as unexpected, not deliberate', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull({ pingIntervalMs: 1000, pongTimeoutMs: 500 });
    await socket.connect();
    vi.advanceTimersByTime(0);

    const events: { deliberate: boolean }[] = [];
    socket.onClose((event: { deliberate: boolean }) => events.push(event));

    vi.advanceTimersByTime(1500);

    expect(events).toEqual([{ deliberate: false }]);
  });
});
