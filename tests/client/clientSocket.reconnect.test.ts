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

describe('ClientSocketWrapper - reconnect backs off', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('doubles the wait between failed attempts', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 60_000, reconnectRandom: () => 0.5 },
      { failReconnects: 3 },
    );
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(0); // retry 1 is instant, fails
    await vi.advanceTimersByTimeAsync(1000); // retry 2 fails
    await vi.advanceTimersByTimeAsync(2000); // retry 3 fails
    await vi.advanceTimersByTimeAsync(3999); // retry 4 is due 4000 after retry 3
    expect(socket.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(socket.isConnected).toBe(true);
  });

  it('stops doubling at the cap', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 2000, reconnectRandom: () => 0.5 },
      { failReconnects: 3 },
    );
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(0); // retry 1 is instant, fails
    await vi.advanceTimersByTimeAsync(1000); // retry 2 fails
    await vi.advanceTimersByTimeAsync(2000); // retry 3 fails, capped
    await vi.advanceTimersByTimeAsync(1999); // retry 4 is capped at 2000, not 4000
    expect(socket.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(socket.isConnected).toBe(true);
  });

  it('spreads the wait with jitter so a fleet of clients cannot stampede', async () => {
    vi.useFakeTimers();
    // random() = 1 pushes the wait to 1.25x, the top of the jitter window
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 60_000, reconnectRandom: () => 1 },
      { failReconnects: 1 },
    );
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(0); // retry 1 is instant, fails
    await vi.advanceTimersByTimeAsync(1249); // retry 2 is due at 1250, not 1000
    expect(socket.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(socket.isConnected).toBe(true);
  });

  it('never gives up, however long the server stays away', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 1000, reconnectRandom: () => 0.5 },
      { failReconnects: 30 },
    );
    await socket.connect();

    socket.simulateServer().simulateClose();
    for (let i = 0; i <= 30; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(socket.isConnected).toBe(true);
  });

  it('a successful connection resets the backoff', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 60_000, reconnectRandom: () => 0.5 },
      { failReconnects: 2 },
    );
    await socket.connect();

    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(0); // retry 1 is instant, fails
    await vi.advanceTimersByTimeAsync(1000); // retry 2 fails
    await vi.advanceTimersByTimeAsync(2000); // retry 3 succeeds
    expect(socket.isConnected).toBe(true);

    // the next drop starts the schedule from the top: instant, not 4000
    socket.simulateServer().simulateClose();
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.isConnected).toBe(true);
  });
});
