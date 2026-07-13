import { describe, expect, it } from 'vitest';
import { ProcessWrapper } from '../../server/infrastructure/process.ts';

// The process seam: requests to stop in, exit codes out, and the deadline timers that
// shutdown policy arms. Nulled, requests are simulated by hand, time only moves
// when a test advances it, and exit() records instead of killing the test runner.
//
// Proposed shape, following the other wrappers:
//   ProcessWrapper.create()            — real process.on / process.exit / setTimeout
//   ProcessWrapper.createNull()        — everything below
//   onShutdownRequest(handler)         — handler receives 'SIGINT' | 'SIGTERM' | 'message'
//   exit(code)                         — real: never returns; null: records { code }
//   startTimer(ms, callback)           — returns a cancel function
//   trackExits()                       — OutputTracker of { code }
//   simulateShutdownRequest(request)   — null only
//   advanceTime(ms)                    — null only, fires timers that come due
describe('ProcessWrapper (null)', () => {
  it('delivers a simulated signal to the handler', () => {
    const proc = ProcessWrapper.createNull();
    const received: string[] = [];

    proc.onShutdownRequest((request) => received.push(request));
    proc.simulateShutdownRequest('SIGTERM');

    expect(received).toEqual(['SIGTERM']);
  });

  // The door a supervisor reaches on Windows, where it cannot raise a signal at all.
  // Nulled, it is the same seam: a request arrives, the handler hears it, and the
  // handler cannot tell from the outside which door it came through.
  it('delivers a simulated shutdown message to the handler', () => {
    const proc = ProcessWrapper.createNull();
    const received: string[] = [];

    proc.onShutdownRequest((request) => received.push(request));
    proc.simulateShutdownRequest('message');

    expect(received).toEqual(['message']);
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

  it('fires due timers in deadline order and skips cancelled ones', () => {
    const proc = ProcessWrapper.createNull();
    const order: number[] = [];

    proc.startTimer(20, () => order.push(20));
    proc.startTimer(10, () => order.push(10));
    const cancel = proc.startTimer(15, () => order.push(15));
    cancel();
    proc.startTimer(5, () => order.push(5));

    proc.advanceTime(20);

    expect(order).toEqual([5, 10, 20]);
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

  it('fires a timer scheduled by another timer, when both come due in the same advance', () => {
    const proc = ProcessWrapper.createNull();
    const order: number[] = [];

    proc.startTimer(10, () => {
      order.push(10);
      proc.startTimer(5, () => order.push(15));
    });

    proc.advanceTime(100);

    expect(order).toEqual([10, 15]);
  });
});
