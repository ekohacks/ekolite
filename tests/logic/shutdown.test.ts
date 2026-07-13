import { describe, expect, it } from 'vitest';
import { ProcessWrapper } from '../../server/infrastructure/process.ts';
import { Shutdown } from '../../server/logic/shutdown.ts';

// Recording double for the app side: a plain closable whose close() the test can
// resolve, reject, or leave hanging, and which counts how often it was asked.
function closableDouble() {
  let closeCalls = 0;
  // Assigned synchronously by the Promise executor below.
  let resolveClose!: () => void;
  let rejectClose!: (err: Error) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClose = resolve;
    rejectClose = reject;
  });
  return {
    closable: {
      close: () => {
        closeCalls += 1;
        return closed;
      },
    },
    closeCalls: () => closeCalls,
    resolveClose,
    rejectClose,
  };
}

// Let settled promises run their then handlers before asserting.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// 7.B.4 (proposed) — graceful shutdown with a deadline.
//
// The policy that used to be three untestable lines in start.ts: on a request to stop,
// close the app; if the close beats the grace period, exit 0; if it hangs, exit 1
// rather than wait for SIGKILL. Runs on ProcessWrapper.createNull() so requests,
// time, and exits are all in the test's hands. The app side is a recording
// double: a plain closable whose close() the test can resolve, hang, or reject.
//
// Proposed shape:
//   new Shutdown(closable, proc, { graceMs? })   — graceMs defaults to 5000
//   shutdown.arm()                               — subscribes to every shutdown door
//
// These activate one at a time, in order, as the ladder is climbed. Each name is
// one behaviour from the design conversation; nothing here tests how (no
// Promise.race assertions, no clearTimeout spies), only what the process observes.
describe('Shutdown', () => {
  it('a signal closes the app, and a clean close exits 0', async () => {
    const { closable, closeCalls, resolveClose } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGTERM');
    expect(closeCalls()).toBe(1);

    resolveClose();
    await flush();

    expect(exits.data).toEqual([{ code: 0 }]);
  });

  // The same policy, through the other door. On Windows this is the only door a
  // supervisor has, so if the message reached ProcessWrapper but stopped short of
  // Shutdown, EkoLite would still be unstoppable there and every test above would
  // still be green.
  it('a shutdown message closes the app, and a clean close exits 0', async () => {
    const { closable, closeCalls, resolveClose } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('message');
    expect(closeCalls()).toBe(1);

    resolveClose();
    await flush();

    expect(exits.data).toEqual([{ code: 0 }]);
  });

  it('exits 1 when the close is still pending at the grace deadline', () => {
    const { closable } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGINT');
    proc.advanceTime(5000);

    // The close never resolved; the deadline exits anyway. No race needed.
    expect(exits.data).toEqual([{ code: 1 }]);
  });

  it('a clean close cancels the deadline: time can pass, only one exit is recorded', async () => {
    const { closable, resolveClose } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGTERM');
    resolveClose();
    await flush();

    // A real process dies at exit(0) and can never testify about a forgotten
    // clearTimeout. The nulled one outlives it, so the mess would show up here.
    proc.advanceTime(60_000);

    expect(exits.data).toEqual([{ code: 0 }]);
  });

  it('the grace period is configurable and fires at the deadline, not before', () => {
    const { closable } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc, { graceMs: 100 }).arm();

    proc.simulateShutdownRequest('SIGTERM');

    proc.advanceTime(99);
    expect(exits.data).toEqual([]);

    proc.advanceTime(1);
    expect(exits.data).toEqual([{ code: 1 }]);
  });

  it('the grace period defaults to five seconds', () => {
    const { closable } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGTERM');

    proc.advanceTime(4999);
    expect(exits.data).toEqual([]);

    proc.advanceTime(1);
    expect(exits.data).toEqual([{ code: 1 }]);
  });

  it('a second signal exits 1 immediately, without waiting for the close', () => {
    const { closable, closeCalls } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGINT');
    proc.simulateShutdownRequest('SIGINT');

    expect(exits.data).toEqual([{ code: 1 }]);
    expect(closeCalls()).toBe(1);
  });

  it('a close that rejects exits 1 instead of dying as an unhandled rejection', async () => {
    const { closable, rejectClose } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGTERM');
    rejectClose(new Error('mongo refused to hang up'));
    await flush();

    expect(exits.data).toEqual([{ code: 1 }]);

    // And the deadline was stood down here too: no second exit later.
    proc.advanceTime(60_000);
    expect(exits.data).toEqual([{ code: 1 }]);
  });

  it('a close that resolves after the deadline does not record a second, clean exit', async () => {
    const { closable, resolveClose } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGTERM');
    proc.advanceTime(5000);
    expect(exits.data).toEqual([{ code: 1 }]);

    resolveClose();
    await flush();

    expect(exits.data).toEqual([{ code: 1 }]);
  });

  it('a second signal exits hard, and a later clean close records no second exit', async () => {
    const { closable, resolveClose } = closableDouble();
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();
    new Shutdown(closable, proc).arm();

    proc.simulateShutdownRequest('SIGTERM');
    proc.simulateShutdownRequest('SIGTERM');
    expect(exits.data).toEqual([{ code: 1 }]);

    resolveClose();
    await flush();

    expect(exits.data).toEqual([{ code: 1 }]);
  });
});
