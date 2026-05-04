import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../server/infrastructure/outputTracker.ts';

describe('EventEmitter.listenerCount', () => {
  it('reports zero for an event that has never been registered', () => {
    const emitter = new EventEmitter();
    expect(emitter.listenerCount('files')).toBe(0);
  });

  it('increments when a handler is registered', () => {
    const emitter = new EventEmitter();
    emitter.on('files', () => {});
    expect(emitter.listenerCount('files')).toBe(1);
    emitter.on('files', () => {});
    expect(emitter.listenerCount('files')).toBe(2);
  });

  it('does not register the same handler twice', () => {
    const emitter = new EventEmitter();
    const handler = (): void => {};
    emitter.on('files', handler);
    emitter.on('files', handler);
    expect(emitter.listenerCount('files')).toBe(1);
  });

  it('does not crash when removing the same handler twice', () => {
    const emitter = new EventEmitter();
    const handler = (): void => {};
    emitter.on('files', handler);

    emitter.off('files', handler);
    expect(() => {
      emitter.off('files', handler);
    }).not.toThrow();
    expect(emitter.listenerCount('files')).toBe(0);
  });

  it('decrements when a handler is removed', () => {
    const emitter = new EventEmitter();
    const handler = (): void => {};
    emitter.on('files', handler);
    emitter.on('files', () => {});
    emitter.off('files', handler);
    expect(emitter.listenerCount('files')).toBe(1);
  });

  it('counts each event type independently', () => {
    const emitter = new EventEmitter();
    emitter.on('files', () => {});
    emitter.on('scripts', () => {});
    emitter.on('scripts', () => {});
    expect(emitter.listenerCount('files')).toBe(1);
    expect(emitter.listenerCount('scripts')).toBe(2);
    expect(emitter.listenerCount('unknown')).toBe(0);
  });
});

describe('EventEmitter.emit', () => {
  it('iterates over a snapshot so handlers can off themselves mid-emit', () => {
    const emitter = new EventEmitter();
    const calls: string[] = [];

    const first = (): void => {
      calls.push('first');
      emitter.off('files', second);
    };
    const second = (): void => {
      calls.push('second');
    };
    const third = (): void => {
      calls.push('third');
    };

    emitter.on('files', first);
    emitter.on('files', second);
    emitter.on('files', third);

    emitter.emit('files', { type: 'insert' });

    expect(calls).toEqual(['first', 'second', 'third']);
  });
});
