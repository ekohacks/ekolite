import type { SpliceScene } from '../scenes/splice.ts';

const NS = 'http://www.w3.org/2000/svg';
const STEP_MS = 1100;
const SHIFT_MS = 600;

const SLOT_W = 110;
const SLOT_H = 64;
const SLOT_GAP = 16;
const ROW_Y = 150;

export function renderSpliceScene(scene: SpliceScene, el: HTMLElement): void {
  el.innerHTML = `
    <div data-role="caption" class="scene-caption"></div>
    <svg class="canvas canvas--splice" viewBox="0 0 600 280" data-role="canvas" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="splice-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#2f855a" />
        </marker>
      </defs>
      <text x="20" y="34" class="lane-label" data-role="row-label">handlers array</text>
      <g data-role="slot-row"></g>
      <g data-role="pointer-group" style="opacity: 0">
        <text class="pointer-i" data-role="pointer-i" x="0" y="${String(ROW_Y - 56)}" text-anchor="middle">i = 0</text>
        <line class="pointer-line" data-role="pointer-line" x1="0" y1="${String(ROW_Y - 38)}" x2="0" y2="${String(ROW_Y - 6)}" marker-end="url(#splice-arrow)" />
      </g>
      <text x="300" y="${String(ROW_Y + SLOT_H + 50)}" text-anchor="middle" class="step-readout" data-role="step-readout"></text>
    </svg>
    <div class="row">
      <button data-action="add-handler" type="button">Add handler</button>
      <button data-action="trigger" type="button">Trigger emit</button>
      <button data-action="reset" type="button">Reset</button>
      <button data-action="set-mode" type="button">Toggle mode</button>
    </div>
    <div data-role="mode"></div>
    <div class="row" data-role="handler-row"></div>
    <div data-role="last-run"></div>
  `;

  const slotRow = el.querySelector<SVGGElement>('[data-role="slot-row"]');
  const rowLabel = el.querySelector<SVGTextElement>('[data-role="row-label"]');
  const pointerGroup = el.querySelector<SVGGElement>('[data-role="pointer-group"]');
  const pointerI = el.querySelector<SVGTextElement>('[data-role="pointer-i"]');
  const pointerLine = el.querySelector<SVGLineElement>('[data-role="pointer-line"]');
  const captionNode = el.querySelector<HTMLElement>('[data-role="caption"]');
  const stepReadout = el.querySelector<SVGTextElement>('[data-role="step-readout"]');

  const modeNode = el.querySelector<HTMLElement>('[data-role="mode"]');
  const handlerRow = el.querySelector<HTMLElement>('[data-role="handler-row"]');
  const lastRunNode = el.querySelector<HTMLElement>('[data-role="last-run"]');

  let gen = 0;

  const slotX = (i: number, total: number): number => {
    const span = Math.max(total, 1);
    const totalW = span * SLOT_W + (span - 1) * SLOT_GAP;
    const start = (600 - totalW) / 2;
    return start + i * (SLOT_W + SLOT_GAP);
  };

  type SlotEl = {
    g: SVGGElement;
    rect: SVGRectElement;
    label: SVGTextElement;
    indexText: SVGTextElement;
  };
  const slotElements = new Map<string, SlotEl>();

  const ensureSlot = (name: string): SlotEl => {
    const existing = slotElements.get(name);
    if (existing) return existing;
    if (!slotRow) throw new Error('slotRow missing');

    const g = document.createElementNS(NS, 'g');
    g.dataset.name = name;
    g.classList.add('slot-group');

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width', String(SLOT_W));
    rect.setAttribute('height', String(SLOT_H));
    rect.setAttribute('rx', '10');
    rect.classList.add('slot');
    g.appendChild(rect);

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(SLOT_W / 2));
    label.setAttribute('y', String(SLOT_H / 2 + 6));
    label.setAttribute('text-anchor', 'middle');
    label.classList.add('slot-label');
    label.textContent = name;
    g.appendChild(label);

    const indexText = document.createElementNS(NS, 'text');
    indexText.setAttribute('x', String(SLOT_W / 2));
    indexText.setAttribute('y', String(SLOT_H + 22));
    indexText.setAttribute('text-anchor', 'middle');
    indexText.classList.add('slot-index');
    g.appendChild(indexText);

    slotRow.appendChild(g);
    const slotEl: SlotEl = { g, rect, label, indexText };
    slotElements.set(name, slotEl);
    return slotEl;
  };

  const positionSlot = (name: string, idx: number, total: number): void => {
    const slot = ensureSlot(name);
    const x = slotX(idx, total);
    slot.g.style.transform = `translate(${String(x)}px, ${String(ROW_Y)}px)`;
    slot.g.classList.remove('slot-group--gone', 'slot-group--ghost');
    slot.indexText.textContent = `[${String(idx)}]`;
  };

  const ghostSlot = (name: string, idx: number, total: number): void => {
    const slot = ensureSlot(name);
    const x = slotX(idx, total);
    slot.g.style.transform = `translate(${String(x)}px, ${String(ROW_Y)}px)`;
    slot.g.classList.remove('slot-group--gone');
    slot.g.classList.add('slot-group--ghost');
    slot.indexText.textContent = '[ghost]';
  };

  const removeSlotVisual = (name: string): void => {
    const slot = slotElements.get(name);
    if (!slot) return;
    slot.g.classList.add('slot-group--gone');
  };

  const setFiredVisual = (name: string, fired: boolean): void => {
    const slot = slotElements.get(name);
    if (!slot) return;
    slot.rect.classList.toggle('slot--fired', fired);
    slot.label.classList.toggle('slot-label--fired', fired);
  };

  const layoutSlots = (
    arrangement: string[],
    opts: { fired?: string[]; ghosts?: string[] } = {},
  ): void => {
    const fired = new Set(opts.fired ?? []);
    const ghosts = opts.ghosts ?? [];
    const totalSlots = arrangement.length + ghosts.length;
    const indexOf = new Map<string, number>();
    arrangement.forEach((name, i) => indexOf.set(name, i));

    const seen = new Set<string>();
    arrangement.forEach((name, i) => {
      positionSlot(name, i, Math.max(totalSlots, arrangement.length));
      setFiredVisual(name, fired.has(name));
      seen.add(name);
    });

    ghosts.forEach((name, ghostIdx) => {
      const slotIdx = arrangement.length + ghostIdx;
      ghostSlot(name, slotIdx, totalSlots);
      setFiredVisual(name, fired.has(name));
      seen.add(name);
    });

    slotElements.forEach((_slot, name) => {
      if (!seen.has(name)) {
        removeSlotVisual(name);
      }
    });
  };

  const movePointerTo = (idx: number, total: number): void => {
    if (!pointerGroup || !pointerI || !pointerLine) return;
    const x = slotX(idx, total) + SLOT_W / 2;
    pointerGroup.style.opacity = '1';
    pointerI.setAttribute('x', String(x));
    pointerLine.setAttribute('x1', String(x));
    pointerLine.setAttribute('x2', String(x));
    pointerI.textContent = `i = ${String(idx)}`;
  };

  const hidePointer = (): void => {
    if (pointerGroup) pointerGroup.style.opacity = '0';
  };

  const setCaption = (html: string): void => {
    if (captionNode) captionNode.innerHTML = html;
  };

  const setStepReadout = (text: string): void => {
    if (stepReadout) stepReadout.textContent = text;
  };

  const setRowLabel = (): void => {
    if (!rowLabel) return;
    rowLabel.textContent =
      scene.mode === 'snapshot'
        ? 'handlers array — emit() iterates a snapshot copy'
        : 'handlers array — emit() iterates the live array directly';
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const drawReadouts = (): void => {
    if (modeNode) {
      modeNode.dataset.value = scene.mode;
      modeNode.textContent = `mode: ${scene.mode}`;
    }
    if (handlerRow) {
      handlerRow.replaceChildren();
      const lastRun = scene.lastRun;
      for (const name of scene.registeredNames) {
        const dot = document.createElement('span');
        dot.dataset.role = 'handler-dot';
        dot.dataset.fired = lastRun.includes(name) ? 'true' : 'false';
        dot.textContent = name;
        handlerRow.appendChild(dot);
      }
    }
    if (lastRunNode) {
      lastRunNode.textContent = `last run: ${scene.lastRun.join(', ')}`;
    }
  };

  const drawIdle = (): void => {
    setRowLabel();
    const live = scene.liveHandlerNames;
    layoutSlots(live);
    hidePointer();
    setStepReadout('');
    setCaption(
      scene.mode === 'snapshot'
        ? '<strong>snapshot mode.</strong> emit() copies handlers before iterating. mutations from inside handlers do not affect this loop.'
        : '<strong>live mode.</strong> emit() iterates the live array. if a handler splices the array, indices shift under the loop.',
    );
  };

  const animate = async (): Promise<void> => {
    gen += 1;
    const myGen = gen;
    const stillCurrent = (): boolean => gen === myGen;

    const startingArray = scene.liveHandlerNames;
    layoutSlots(startingArray);
    hidePointer();

    scene.trigger();
    drawReadouts();

    const steps = scene.lastSteps;

    if (steps.length === 0) return;

    const fired: string[] = [];
    const ghostsForSnapshot: string[] = [];

    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      fired.push(step.name);

      const arrangement = scene.mode === 'snapshot' ? steps.map((st) => st.name) : step.liveAfter;

      const ghosts: string[] = [];
      if (scene.mode === 'snapshot') {
        for (const name of ghostsForSnapshot) {
          if (!arrangement.includes(name)) ghosts.push(name);
        }
      }

      const arrangementBefore = s === 0 ? startingArray : steps[s - 1].liveAfter;
      if (scene.mode === 'live') {
        layoutSlots(arrangementBefore, { fired: fired.slice(0, -1) });
      } else {
        layoutSlots(arrangement, { fired: fired.slice(0, -1), ghosts });
      }

      const pointerIdx = step.index;
      const pointerTotal =
        scene.mode === 'snapshot' ? arrangement.length : Math.max(arrangementBefore.length, 1);
      movePointerTo(pointerIdx, pointerTotal);

      const slotName =
        scene.mode === 'snapshot' ? arrangement[pointerIdx] : arrangementBefore[pointerIdx];
      setStepReadout(
        scene.mode === 'snapshot'
          ? `step ${String(s + 1)}: i=${String(step.index)}, snapshot[${String(step.index)}] is "${slotName}", calling it`
          : `step ${String(s + 1)}: i=${String(step.index)}, handlers[${String(step.index)}] is "${slotName}", calling it`,
      );

      await wait(STEP_MS / 2);
      if (!stillCurrent()) return;

      // animate the splice if this step removed something
      const liveBefore = arrangementBefore;
      const liveAfter = step.liveAfter;
      const removed = liveBefore.filter((n) => !liveAfter.includes(n));

      if (removed.length > 0) {
        if (scene.mode === 'live') {
          layoutSlots(liveAfter, { fired });
          setStepReadout(
            `splice! "${removed.join(', ')}" removed. live array shifts: indices renumber, the loop moves to i=${String(step.index + 1)} which is now a different handler.`,
          );
        } else {
          for (const name of removed) {
            if (!ghostsForSnapshot.includes(name)) ghostsForSnapshot.push(name);
          }
          const ghostList: string[] = [];
          for (const n of ghostsForSnapshot) {
            if (!arrangement.includes(n)) ghostList.push(n);
          }
          layoutSlots(arrangement, { fired, ghosts: ghostList });
          setStepReadout(
            `live array changed: "${removed.join(', ')}" removed. but the snapshot is unchanged, so iteration continues over [${arrangement.join(', ')}].`,
          );
        }
        await wait(SHIFT_MS);
        if (!stillCurrent()) return;
      }

      if (scene.mode === 'live') {
        layoutSlots(liveAfter, { fired });
      }

      await wait(STEP_MS / 2);
      if (!stillCurrent()) return;
    }

    hidePointer();

    if (scene.mode === 'live') {
      const skipped = scene.registeredNames.filter((n) => !scene.lastRun.includes(n));
      setCaption(
        skipped.length > 0
          ? `<strong>bug visible:</strong> ${skipped.length === 1 ? '"' + skipped[0] + '" was' : skipped.map((s) => `"${s}"`).join(', ') + ' were'} never called. the splice shifted the array under the loop.`
          : '<strong>live mode.</strong> emit() iterates the live array directly.',
      );
      setStepReadout(`final: ran [${scene.lastRun.join(', ')}], skipped [${skipped.join(', ')}].`);
    } else {
      setCaption(
        '<strong>snapshot mode.</strong> every handler in the snapshot ran, even ones removed from the live array mid emit.',
      );
      setStepReadout(
        `final: ran [${scene.lastRun.join(', ')}], live array now [${scene.liveHandlerNames.join(', ')}].`,
      );
    }
  };

  el.querySelector<HTMLButtonElement>('[data-action="add-handler"]')?.addEventListener(
    'click',
    () => {
      scene.addHandler(`h${String(scene.handlerCount + 1)}`);
      drawIdle();
      drawReadouts();
    },
  );
  el.querySelector<HTMLButtonElement>('[data-action="trigger"]')?.addEventListener('click', () => {
    void animate();
  });
  el.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', () => {
    gen += 1;
    scene.reset();
    slotElements.forEach((slot) => {
      slot.g.remove();
    });
    slotElements.clear();
    drawIdle();
    drawReadouts();
  });
  el.querySelector<HTMLButtonElement>('[data-action="set-mode"]')?.addEventListener('click', () => {
    gen += 1;
    scene.setMode(scene.mode === 'snapshot' ? 'live' : 'snapshot');
    drawIdle();
    drawReadouts();
  });

  drawIdle();
  drawReadouts();
}
