import { describe, expect, it } from 'vitest';
import { ClosureCaptureScene } from '../scenes/closureCapture.ts';

describe('ClosureCaptureScene', () => {
  it('starts with no subscriptions and no listeners on the channel', () => {
    const scene = new ClosureCaptureScene();
    expect(scene.subscriptionCount).toBe(0);
    expect(scene.listenerCount('files')).toBe(0);
  });

  it('subscribing in closure mode registers a wrapper on the channel', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('closure');

    scene.subscribe('files', () => {});

    expect(scene.subscriptionCount).toBe(1);
    expect(scene.listenerCount('files')).toBe(1);
  });

  it('triggering the channel calls each subscribed callback once', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('closure');
    let calls = 0;
    scene.subscribe('files', () => {
      calls++;
    });

    scene.trigger('files');

    expect(calls).toBe(1);
  });

  it('cleanup in closure mode removes the wrapper from the channel', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('closure');
    const off = scene.subscribe('files', () => {});

    off();

    expect(scene.listenerCount('files')).toBe(0);
  });

  it('cleanup in direct mode leaves the wrapper on the channel', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('direct');
    const off = scene.subscribe('files', () => {});

    off();

    expect(scene.listenerCount('files')).toBe(1);
  });

  it('after a broken cleanup in direct mode, triggering still calls the callback', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('direct');
    let calls = 0;
    const off = scene.subscribe('files', () => {
      calls++;
    });

    off();
    scene.trigger('files');

    expect(calls).toBe(1);
  });

  it('repeated subscribe and cleanup cycles do not accumulate listeners in closure mode', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('closure');

    for (let i = 0; i < 5; i++) {
      const off = scene.subscribe('files', () => {});
      off();
    }

    expect(scene.listenerCount('files')).toBe(0);
  });

  it('repeated subscribe and cleanup cycles accumulate listeners in direct mode', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('direct');

    for (let i = 0; i < 5; i++) {
      const off = scene.subscribe('files', () => {});
      off();
    }

    expect(scene.listenerCount('files')).toBe(5);
  });

  it('cleanup behaviour is fixed at subscribe time, not at cleanup time', () => {
    const scene = new ClosureCaptureScene();

    scene.setMode('closure');
    const offClosure = scene.subscribe('files', () => {});

    scene.setMode('direct');
    const offDirect = scene.subscribe('files', () => {});

    expect(scene.listenerCount('files')).toBe(2);

    offClosure();
    expect(scene.listenerCount('files')).toBe(1);

    offDirect();
    expect(scene.listenerCount('files')).toBe(1);
  });

  it('cleanup of one subscription does not affect others', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('closure');
    const calls = { a: 0, b: 0 };

    const offA = scene.subscribe('files', () => {
      calls.a++;
    });
    scene.subscribe('files', () => {
      calls.b++;
    });

    offA();
    scene.trigger('files');

    expect(calls.a).toBe(0);
    expect(calls.b).toBe(1);
  });

  it('exposes a transition tracker that records each step for animation', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('closure');
    const events: string[] = [];
    scene.onTransition((event) => {
      events.push(event.kind);
    });

    const off = scene.subscribe('files', () => {});
    scene.trigger('files');
    off();

    expect(events).toEqual(['subscribe', 'trigger', 'cleanup']);
  });

  it('emits a leakedCleanup transition when a direct mode cleanup fails to remove its listener', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('direct');
    const events: string[] = [];
    scene.onTransition((event) => {
      events.push(event.kind);
    });

    const off = scene.subscribe('files', () => {});
    off();

    expect(events).toEqual(['subscribe', 'leakedCleanup']);
  });

  it('reset clears every listener on every channel', () => {
    const scene = new ClosureCaptureScene();
    scene.setMode('direct');
    scene.subscribe('files', () => {});
    scene.subscribe('files', () => {});
    scene.subscribe('users', () => {});

    expect(scene.listenerCount('files')).toBe(2);
    expect(scene.listenerCount('users')).toBe(1);

    scene.reset();

    expect(scene.listenerCount('files')).toBe(0);
    expect(scene.listenerCount('users')).toBe(0);
    expect(scene.subscriptionCount).toBe(0);
  });

  it('triggering after reset does not fire any of the previously subscribed callbacks', () => {
    const scene = new ClosureCaptureScene();
    let calls = 0;
    scene.subscribe('files', () => {
      calls++;
    });

    scene.reset();
    scene.trigger('files');

    expect(calls).toBe(0);
  });
});
