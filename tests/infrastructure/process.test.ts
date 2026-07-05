import { describe, expect, it } from 'vitest';
import { ProcessWrapper } from '../../server/infrastructure/process.ts';

// The process seam: signals in, exit codes out, and the deadline timers that
// shutdown policy arms. Nulled, signals are simulated by hand, time only moves
// when a test advances it, and exit() records instead of killing the test runner.
//
// Proposed shape, following the other wrappers:
//   ProcessWrapper.create()            — real process.on / process.exit / setTimeout
//   ProcessWrapper.createNull()        — everything below
//   onSignal(handler)                  — handler receives 'SIGINT' | 'SIGTERM'
//   exit(code)                         — real: never returns; null: records { code }
//   startTimer(ms, callback)           — returns a cancel function
//   trackExits()                       — OutputTracker of { code }
//   simulateSignal(signal)             — null only
//   advanceTime(ms)                    — null only, fires timers that come due
describe('ProcessWrapper (null)', () => {
  it('delivers a simulated signal to the handler', () => {
    const proc = ProcessWrapper.createNull();
    const received: string[] = [];

    proc.onSignal((signal) => received.push(signal));
    proc.simulateSignal('SIGTERM');

    expect(received).toEqual(['SIGTERM']);
  });

  it('records exits in an output tracker instead of killing the process', () => {
    const proc = ProcessWrapper.createNull();
    const exits = proc.trackExits();

    proc.exit(0);
    proc.exit(1);

    expect(exits.data).toEqual([{ code: 0 }, { code: 1 }]);
  });

  it('fires a timer when time advances to its deadline, and not before', () => {
    const proc = ProcessWrapper.createNull();
    let fired = false;

    proc.startTimer(5000, () => {
      fired = true;
    });

    proc.advanceTime(4999);
    expect(fired).toBe(false);

    proc.advanceTime(1);
    expect(fired).toBe(true);
  });

  it('never fires a cancelled timer, however far time advances', () => {
    const proc = ProcessWrapper.createNull();
    let fired = false;

    const cancel = proc.startTimer(5000, () => {
      fired = true;
    });
    cancel();

    proc.advanceTime(60_000);
    expect(fired).toBe(false);
  });
});
