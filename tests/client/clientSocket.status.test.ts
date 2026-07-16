import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

// The shape this red demands: a status the application can read at any
// moment, so an outage is something a page can render instead of hide.
const statusOf = (socket: ClientSocketWrapper): ConnectionStatus =>
  (socket as unknown as { status: ConnectionStatus }).status;

describe('ClientSocketWrapper - connection status', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports connecting before the socket first opens', () => {
    const socket = ClientSocketWrapper.createNull();

    expect(statusOf(socket)).toBe('connecting');
  });

  it('reports connected once the socket is open', async () => {
    const socket = ClientSocketWrapper.createNull();

    await socket.connect();

    expect(statusOf(socket)).toBe('connected');
  });

  it('reports reconnecting from the unexpected close until the socket is back', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull(
      { reconnectBaseMs: 1000, reconnectMaxMs: 60_000, reconnectRandom: () => 0.5 },
      { failReconnects: 1 },
    );
    await socket.connect();

    socket.simulateServer().simulateClose();
    expect(statusOf(socket)).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(0); // retry 1 fails
    expect(statusOf(socket)).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(1000); // retry 2 opens

    expect(statusOf(socket)).toBe('connected');
  });

  it('reports closed after a deliberate close', async () => {
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();

    await socket.close();

    expect(statusOf(socket)).toBe('closed');
  });

  it('reports closed when reconnect is off and the socket dies', async () => {
    const socket = ClientSocketWrapper.createNull({ reconnect: false });
    await socket.connect();

    socket.simulateServer().simulateClose();

    expect(statusOf(socket)).toBe('closed');
  });
});
