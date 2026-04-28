import { describe, expect, it } from 'vitest';
import { SpliceScene } from '../scenes/splice.ts';

describe('SpliceScene', () => {
  it('runs every handler in registration order with no removal', () => {
    const scene = new SpliceScene();
    scene.addHandler('first');
    scene.addHandler('second');
    scene.addHandler('third');

    scene.trigger();

    expect(scene.lastRun).toEqual(['first', 'second', 'third']);
  });

  it('skips a handler that gets removed mid emit when iterating live', () => {
    const scene = new SpliceScene();
    scene.setMode('live');
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');

    scene.trigger();

    expect(scene.lastRun).toEqual(['first', 'third']);
  });

  it('still runs every handler when iterating over a snapshot', () => {
    const scene = new SpliceScene();
    scene.setMode('snapshot');
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');

    scene.trigger();

    expect(scene.lastRun).toEqual(['first', 'second', 'third']);
  });

  it('reports handler count after each trigger', () => {
    const scene = new SpliceScene();
    scene.setMode('snapshot');
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');

    expect(scene.handlerCount).toBe(3);
    scene.trigger();
    expect(scene.handlerCount).toBe(2);
  });

  it('changing mode between triggers takes effect on the next trigger only', () => {
    const scene = new SpliceScene();
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');

    scene.setMode('live');
    scene.trigger();
    expect(scene.lastRun).toEqual(['first', 'third']);

    scene.reset();
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');
    scene.setMode('snapshot');
    scene.trigger();
    expect(scene.lastRun).toEqual(['first', 'second', 'third']);
  });

  it('emits step events callers can subscribe to for animation', () => {
    const scene = new SpliceScene();
    const steps: { name: string; index: number }[] = [];
    scene.onStep((step) => {
      steps.push(step);
    });

    scene.addHandler('first');
    scene.addHandler('second');
    scene.addHandler('third');
    scene.trigger();

    expect(steps).toEqual([
      { name: 'first', index: 0 },
      { name: 'second', index: 1 },
      { name: 'third', index: 2 },
    ]);
  });
});
