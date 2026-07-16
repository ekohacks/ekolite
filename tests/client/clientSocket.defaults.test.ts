import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';

const pings = (data: unknown[]) => data.filter((m) => (m as { type: string }).type === 'ping');

describe('ClientSocketWrapper - the heartbeat is on out of the box', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings with no configuration at all', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();
    vi.advanceTimersByTime(0);
    const tracker = socket.trackMessages();

    vi.advanceTimersByTime(15_000);

    expect(pings(tracker.data)).toHaveLength(1);
  });

  it('closes a silent connection and brings it back, all by itself', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull();
    await socket.connect();
    vi.advanceTimersByTime(0);
    const closes: { deliberate: boolean }[] = [];
    socket.onClose((event) => closes.push(event));

    // the ping at 15s goes unanswered, so the pong window shuts at 25s
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(50); // the instant retry lands just after

    expect(closes).toEqual([{ deliberate: false }]);
    expect(socket.isConnected).toBe(true); // and it is already back
  });

  it('a zero interval switches the heartbeat off', async () => {
    vi.useFakeTimers();
    const socket = ClientSocketWrapper.createNull({ pingIntervalMs: 0 });
    await socket.connect();
    vi.advanceTimersByTime(0);
    const tracker = socket.trackMessages();

    vi.advanceTimersByTime(120_000);

    expect(pings(tracker.data)).toHaveLength(0);
  });
});
