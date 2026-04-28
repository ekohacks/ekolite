// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SpliceScene } from '../scenes/splice.ts';
import { renderSpliceScene } from '../renderers/splice.ts';

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

describe('renderSpliceScene', () => {
  it('renders the four scene controls', () => {
    const scene = new SpliceScene();
    const el = mount();

    renderSpliceScene(scene, el);

    expect(el.querySelector("[data-action='add-handler']")).not.toBeNull();
    expect(el.querySelector("[data-action='trigger']")).not.toBeNull();
    expect(el.querySelector("[data-action='reset']")).not.toBeNull();
    expect(el.querySelector("[data-action='set-mode']")).not.toBeNull();
  });

  it('shows a dot per registered handler labelled with its name', () => {
    const scene = new SpliceScene();
    scene.addHandler('first');
    scene.addHandler('second');
    scene.addHandler('third');
    const el = mount();

    renderSpliceScene(scene, el);

    const dots = el.querySelectorAll("[data-role='handler-dot']");
    expect(dots).toHaveLength(3);
    expect(dots[0].textContent).toContain('first');
    expect(dots[1].textContent).toContain('second');
    expect(dots[2].textContent).toContain('third');
  });

  it('clicking add-handler grows the handler dot count', () => {
    const scene = new SpliceScene();
    const el = mount();
    renderSpliceScene(scene, el);

    expect(el.querySelectorAll("[data-role='handler-dot']")).toHaveLength(0);

    click(el, 'add-handler');
    click(el, 'add-handler');

    expect(el.querySelectorAll("[data-role='handler-dot']")).toHaveLength(2);
  });

  it('clicking trigger marks each fired dot as fired in run order', () => {
    const scene = new SpliceScene();
    scene.addHandler('first');
    scene.addHandler('second');
    scene.addHandler('third');
    const el = mount();
    renderSpliceScene(scene, el);

    click(el, 'trigger');

    const dots = el.querySelectorAll<HTMLElement>("[data-role='handler-dot']");
    expect(dots[0].dataset.fired).toBe('true');
    expect(dots[1].dataset.fired).toBe('true');
    expect(dots[2].dataset.fired).toBe('true');
  });

  it('renders the current iteration mode and flips it on click', () => {
    const scene = new SpliceScene();
    const el = mount();
    renderSpliceScene(scene, el);

    const modeReadout = el.querySelector("[data-role='mode']");
    expect(modeReadout?.textContent).toContain('snapshot');

    click(el, 'set-mode');

    expect(modeReadout?.textContent).toContain('live');
  });

  it('shows the live mode skip on the dots after trigger', () => {
    const scene = new SpliceScene();
    scene.setMode('live');
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');
    const el = mount();
    renderSpliceScene(scene, el);

    click(el, 'trigger');

    const dots = el.querySelectorAll<HTMLElement>("[data-role='handler-dot']");
    expect(dots[0].dataset.fired).toBe('true');
    expect(dots[1].dataset.fired).toBe('false');
    expect(dots[2].dataset.fired).toBe('true');
  });

  it('shows every dot fired in snapshot mode even when one is removed', () => {
    const scene = new SpliceScene();
    scene.setMode('snapshot');
    scene.addHandler('first', { removes: 'second' });
    scene.addHandler('second');
    scene.addHandler('third');
    const el = mount();
    renderSpliceScene(scene, el);

    click(el, 'trigger');

    const dots = el.querySelectorAll<HTMLElement>("[data-role='handler-dot']");
    expect(dots[0].dataset.fired).toBe('true');
    expect(dots[1].dataset.fired).toBe('true');
    expect(dots[2].dataset.fired).toBe('true');
  });

  it('clicking reset clears the dots and the run readout', () => {
    const scene = new SpliceScene();
    scene.addHandler('first');
    scene.addHandler('second');
    const el = mount();
    renderSpliceScene(scene, el);
    click(el, 'trigger');

    click(el, 'reset');

    expect(el.querySelectorAll("[data-role='handler-dot']")).toHaveLength(0);
    const readout = el.querySelector("[data-role='last-run']");
    expect(readout?.textContent).not.toContain('first');
  });
});
