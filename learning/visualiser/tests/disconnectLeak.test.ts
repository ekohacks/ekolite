import { describe, expect, it } from 'vitest';
import { DisconnectLeakScene } from '../scenes/disconnectLeak.ts';

describe('DisconnectLeakScene', () => {
  it('starts with no clients and no watchers', () => {
    const scene = new DisconnectLeakScene();
    expect(scene.clientCount).toBe(0);
    expect(scene.watcherCount('files')).toBe(0);
  });

  it('subscribing a client opens a watcher on the collection', () => {
    const scene = new DisconnectLeakScene();
    const clientId = scene.connectClient();
    scene.subscribe(clientId, 'sub1', 'files');

    expect(scene.watcherCount('files')).toBe(1);
  });

  it('disconnecting a client tears down its watcher when fix is on', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('on');
    const clientId = scene.connectClient();
    scene.subscribe(clientId, 'sub1', 'files');

    scene.disconnect(clientId);

    expect(scene.watcherCount('files')).toBe(0);
  });

  it('disconnecting leaves the watcher behind when fix is off', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('off');
    const clientId = scene.connectClient();
    scene.subscribe(clientId, 'sub1', 'files');

    scene.disconnect(clientId);

    expect(scene.watcherCount('files')).toBe(1);
  });

  it('only tears down the disconnecting client when fix is on', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('on');
    const a = scene.connectClient();
    const b = scene.connectClient();
    scene.subscribe(a, 'sub1', 'files');
    scene.subscribe(b, 'sub1', 'files');

    expect(scene.watcherCount('files')).toBe(2);

    scene.disconnect(a);

    expect(scene.watcherCount('files')).toBe(1);
  });

  it('repeated subscribe and disconnect cycles do not accumulate watchers when fix is on', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('on');

    for (let i = 0; i < 5; i++) {
      const clientId = scene.connectClient();
      scene.subscribe(clientId, 'sub1', 'files');
      scene.disconnect(clientId);
    }

    expect(scene.watcherCount('files')).toBe(0);
  });

  it('repeated subscribe and disconnect cycles accumulate watchers when fix is off', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('off');

    for (let i = 0; i < 5; i++) {
      const clientId = scene.connectClient();
      scene.subscribe(clientId, 'sub1', 'files');
      scene.disconnect(clientId);
    }

    expect(scene.watcherCount('files')).toBe(5);
  });

  it('exposes a tracker that records each state transition for animation', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('on');
    const events: string[] = [];
    scene.onTransition((event) => {
      events.push(event.kind);
    });

    const clientId = scene.connectClient();
    scene.subscribe(clientId, 'sub1', 'files');
    scene.disconnect(clientId);

    expect(events).toEqual(['connect', 'subscribe', 'disconnect', 'cleanup']);
  });

  it('does not emit a cleanup transition when fix is off', () => {
    const scene = new DisconnectLeakScene();
    scene.setFix('off');
    const events: string[] = [];
    scene.onTransition((event) => {
      events.push(event.kind);
    });

    const clientId = scene.connectClient();
    scene.subscribe(clientId, 'sub1', 'files');
    scene.disconnect(clientId);

    expect(events).toEqual(['connect', 'subscribe', 'disconnect']);
  });
});
