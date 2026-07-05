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
// The policy that used to be three untestable lines in start.ts: on a signal,
// close the app; if the close beats the grace period, exit 0; if it hangs, exit 1
// rather than wait for SIGKILL. Runs on ProcessWrapper.createNull() so signals,
// time, and exits are all in the test's hands. The app side is a recording
// double: a plain closable whose close() the test can resolve, hang, or reject.
//
// Proposed shape:
//   new Shutdown(closable, proc, { graceMs? })   — graceMs defaults to 5000
//   shutdown.arm()                               — subscribes to SIGINT and SIGTERM
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

    proc.simulateSignal('SIGTERM');
    expect(closeCalls()).toBe(1);

    resolveClose();
    await flush();

    expect(exits.data).toEqual([{ code: 0 }]);
  });

  it.todo('exits 1 when the close is still pending at the grace deadline');

  it.todo('a clean close cancels the deadline: time can pass, only one exit is recorded');

  it.todo('the grace period is configurable and fires at the deadline, not before');

  it.todo('the grace period defaults to five seconds');

  it.todo('a second signal exits 1 immediately, without waiting for the close');

  it.todo('a close that rejects exits 1 instead of dying as an unhandled rejection');
});
