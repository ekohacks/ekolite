// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DisconnectLeakScene } from '../scenes/disconnectLeak.ts';
import { renderDisconnectLeakScene } from '../renderers/disconnectLeak.ts';

const mount = (): HTMLElement => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
};

const click = (root: HTMLElement, action: string): void => {
  const button = root.querySelector<HTMLButtonElement>(`[data-action='${action}']`);
  if (!button) throw new Error(`No button with data-action='${action}'`);
  button.click();
};

describe('renderDisconnectLeakScene', () => {
  it('renders the scene controls', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();

    renderDisconnectLeakScene(scene, el);

    expect(el.querySelector("[data-action='connect']")).not.toBeNull();
    expect(el.querySelector("[data-action='subscribe']")).not.toBeNull();
    expect(el.querySelector("[data-action='disconnect']")).not.toBeNull();
    expect(el.querySelector("[data-action='set-fix']")).not.toBeNull();
  });

  it('shows the watcher count starting at zero', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();

    renderDisconnectLeakScene(scene, el);

    const readout = el.querySelector("[data-role='watcher-count']");
    expect(readout?.textContent).toContain('0');
  });

  it('shows the current fix state and flips it on click', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    const fixReadout = el.querySelector("[data-role='fix-state']");
    expect(fixReadout?.textContent).toContain('on');

    click(el, 'set-fix');

    expect(fixReadout?.textContent).toContain('off');
  });

  it('clicking connect adds a client dot and updates the count', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    click(el, 'connect');

    expect(el.querySelectorAll("[data-role='client-dot']")).toHaveLength(1);
    const clients = el.querySelector("[data-role='client-count']");
    expect(clients?.textContent).toContain('1');
  });

  it('clicking subscribe after connect grows the watcher count', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    click(el, 'connect');
    click(el, 'subscribe');

    const watchers = el.querySelector("[data-role='watcher-count']");
    expect(watchers?.textContent).toContain('1');
  });

  it('with fix on, disconnect drops the watcher count back to zero', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    click(el, 'connect');
    click(el, 'subscribe');
    click(el, 'disconnect');

    const watchers = el.querySelector("[data-role='watcher-count']");
    expect(watchers?.textContent).toContain('0');
  });

  it('with fix off, disconnect leaves the watcher count alone', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    click(el, 'set-fix');
    click(el, 'connect');
    click(el, 'subscribe');
    click(el, 'disconnect');

    const watchers = el.querySelector("[data-role='watcher-count']");
    expect(watchers?.textContent).toContain('1');
  });

  it('appends each transition to a visible log in order', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    click(el, 'connect');
    click(el, 'subscribe');
    click(el, 'disconnect');

    const entries = el.querySelectorAll("[data-role='transition-entry']");
    const kinds = Array.from(entries).map((entry) => entry.textContent);
    expect(kinds[0]).toContain('connect');
    expect(kinds[1]).toContain('subscribe');
    expect(kinds[2]).toContain('disconnect');
    expect(kinds[3]).toContain('cleanup');
  });

  it('shows the diverging story when you flip fix and re-run', () => {
    const scene = new DisconnectLeakScene();
    const el = mount();
    renderDisconnectLeakScene(scene, el);

    click(el, 'set-fix');
    for (let i = 0; i < 3; i++) {
      click(el, 'connect');
      click(el, 'subscribe');
      click(el, 'disconnect');
    }
    const watchersOff = el.querySelector("[data-role='watcher-count']");
    expect(watchersOff?.textContent).toContain('3');
  });
});
