import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

const subscribeMessages = (data: unknown[]): SubscribeMsg[] =>
  data.filter((m): m is SubscribeMsg => (m as { type: string }).type === 'subscribe');

describe('ConnectionManager - resubscribe after the socket comes back', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resends every subscription with its original id, name and params', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    await socket.connect();
    const messages = socket.trackMessages();

    manager.subscribe('files.all', { room: 'evros' });
    manager.subscribe('counts.byFile');
    const before = subscribeMessages(messages.data);

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(50);

    const after = subscribeMessages(messages.data);
    expect(after).toHaveLength(4);
    expect(after.slice(2)).toEqual(before);
  });

  it('does not resubscribe until a socket actually reopens', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 60_000, reconnectRandom: () => 0.5 },
      { failReconnects: 1 },
    );
    const manager = new ConnectionManager(socket);
    await socket.connect();
    const messages = socket.trackMessages();

    manager.subscribe('files.all');

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(0); // retry 1 fails to open
    expect(subscribeMessages(messages.data)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000); // retry 2 opens

    expect(subscribeMessages(messages.data)).toHaveLength(2);
  });
});
