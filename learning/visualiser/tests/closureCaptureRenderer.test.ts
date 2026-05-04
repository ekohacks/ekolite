// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ClosureCaptureScene } from '../scenes/closureCapture.ts';
import { renderClosureCaptureScene } from '../renderers/closureCapture.ts';

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

const clickIn = (row: Element, action: string): void => {
  const button = row.querySelector<HTMLButtonElement>(`[data-action='${action}']`);
  if (!button) throw new Error(`No button with data-action='${action}' in row`);
  button.click();
};

describe('renderClosureCaptureScene', () => {
  it('renders the four scene controls', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();

    renderClosureCaptureScene(scene, el);

    expect(el.querySelector("[data-action='subscribe']")).not.toBeNull();
    expect(el.querySelector("[data-action='trigger']")).not.toBeNull();
    expect(el.querySelector("[data-action='set-mode']")).not.toBeNull();
    expect(el.querySelector("[data-action='reset']")).not.toBeNull();
  });

  it('shows the listener count rising as you subscribe', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    click(el, 'subscribe');

    const count = el.querySelector<HTMLElement>("[data-role='listener-count']");
    expect(count?.textContent).toContain('2');
  });

  it('flips between closure and direct mode on click', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    const modeReadout = el.querySelector("[data-role='mode-state']");
    expect(modeReadout?.textContent).toContain('closure');

    click(el, 'set-mode');

    expect(modeReadout?.textContent).toContain('direct');
  });

  it('cleanup in closure mode removes the subscription row from the active list', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');

    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset.alive).toBe('true');

    clickIn(rows[0], 'cleanup');

    const updatedRows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    expect(updatedRows[0].dataset.alive).toBe('false');
    expect(updatedRows[0].dataset.leaked).toBe('false');
  });

  it('cleanup in direct mode marks the row as leaked', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'set-mode');
    click(el, 'subscribe');

    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'cleanup');

    const updatedRows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    expect(updatedRows[0].dataset.leaked).toBe('true');
    const count = el.querySelector<HTMLElement>("[data-role='listener-count']");
    expect(count?.textContent).toContain('1');
  });

  it('triggering after a leaked cleanup still fires the callback', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'set-mode');
    click(el, 'subscribe');

    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'cleanup');

    click(el, 'trigger');

    const callCount = el.querySelector<HTMLElement>("[data-role='call-count']");
    expect(callCount?.textContent).toContain('1');
  });

  it('reset clears subscriptions and the listener count', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    click(el, 'subscribe');

    click(el, 'reset');

    const rows = el.querySelectorAll("[data-role='subscription-row']");
    expect(rows).toHaveLength(0);
    const count = el.querySelector<HTMLElement>("[data-role='listener-count']");
    expect(count?.textContent).toContain('0');
  });

  it('each new subscription row has a drop-reference button', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');

    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    expect(rows[0].querySelector("[data-action='drop']")).not.toBeNull();
  });

  it('dropping the reference leaves the listener attached to the emitter', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'drop');

    const listenerCount = el.querySelector<HTMLElement>("[data-role='listener-count']");
    expect(listenerCount?.textContent).toContain('1');
  });

  it('dropping the reference removes the cleanup button from the row', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'drop');

    const updated = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    expect(updated[0].querySelector("[data-action='cleanup']")).toBeNull();
    expect(updated[0].dataset.released).toBe('true');
  });

  it('shows an active-subs count separate from the listener count', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    click(el, 'subscribe');
    click(el, 'subscribe');
    click(el, 'subscribe');
    click(el, 'subscribe');

    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'drop');

    const active = el.querySelector<HTMLElement>("[data-role='active-count']");
    const listeners = el.querySelector<HTMLElement>("[data-role='listener-count']");
    expect(active?.textContent).toContain('4');
    expect(listeners?.textContent).toContain('5');
  });

  it('triggering after a dropped reference still fires the released wrapper', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'drop');

    click(el, 'trigger');

    const callCount = el.querySelector<HTMLElement>("[data-role='call-count']");
    expect(callCount?.textContent).toContain('1');
  });

  it('reset clears released subscriptions too', () => {
    const scene = new ClosureCaptureScene();
    const el = mount();
    renderClosureCaptureScene(scene, el);

    click(el, 'subscribe');
    click(el, 'subscribe');
    const rows = el.querySelectorAll<HTMLElement>("[data-role='subscription-row']");
    clickIn(rows[0], 'drop');

    click(el, 'reset');

    const updated = el.querySelectorAll("[data-role='subscription-row']");
    expect(updated).toHaveLength(0);
    const listeners = el.querySelector<HTMLElement>("[data-role='listener-count']");
    expect(listeners?.textContent).toContain('0');
  });
});
