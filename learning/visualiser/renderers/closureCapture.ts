import type { ClosureCaptureScene, Transition } from '../scenes/closureCapture.ts';

const NS = 'http://www.w3.org/2000/svg';

interface SubscriptionRow {
  id: number;
  cbLabel: string;
  modeAtSubscribe: 'closure' | 'direct';
  off: () => void;
  alive: boolean;
  leaked: boolean;
  released: boolean;
}

export function renderClosureCaptureScene(scene: ClosureCaptureScene, el: HTMLElement): void {
  el.innerHTML = `
    <div data-role="caption" class="scene-caption"></div>
    <svg class="canvas canvas--closure" viewBox="0 0 600 320" data-role="canvas" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="closure-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#2f855a" />
        </marker>
        <marker id="closure-arrow-leak" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#c05621" />
        </marker>
      </defs>
      <text x="120" y="30" class="lane-label" text-anchor="middle">caller</text>
      <text x="480" y="30" class="lane-label" text-anchor="middle">emitter (channel: files)</text>
      <rect class="emitter-box" x="420" y="50" width="160" height="240" rx="8" />
      <text class="emitter-count" data-role="emitter-count" x="500" y="170" text-anchor="middle">0</text>
      <text class="emitter-caption" x="500" y="200" text-anchor="middle">listeners</text>
      <g data-role="rows"></g>
    </svg>
    <div class="row">
      <button data-action="subscribe" type="button">Subscribe</button>
      <button data-action="trigger" type="button">Trigger event</button>
      <button data-action="set-mode" type="button">Toggle mode</button>
      <button data-action="reset" type="button">Reset</button>
    </div>
    <div class="row">
      <span data-role="mode-state"></span>
      <span data-role="listener-count"></span>
      <span data-role="active-count"></span>
      <span data-role="call-count"></span>
    </div>
    <div class="stack" data-role="subscription-list"></div>
    <div class="stack" data-role="transition-log"></div>
  `;

  const rowsGroup = el.querySelector<SVGGElement>('[data-role="rows"]');
  const emitterCount = el.querySelector<SVGTextElement>('[data-role="emitter-count"]');
  const captionNode = el.querySelector<HTMLElement>('[data-role="caption"]');
  const modeStateNode = el.querySelector<HTMLElement>('[data-role="mode-state"]');
  const listenerCountNode = el.querySelector<HTMLElement>('[data-role="listener-count"]');
  const activeCountNode = el.querySelector<HTMLElement>('[data-role="active-count"]');
  const callCountNode = el.querySelector<HTMLElement>('[data-role="call-count"]');
  const subscriptionList = el.querySelector<HTMLElement>('[data-role="subscription-list"]');
  const log = el.querySelector<HTMLElement>('[data-role="transition-log"]');

  const subs: SubscriptionRow[] = [];
  let nextId = 1;
  let totalCalls = 0;
  let lastTriggerCalls = 0;

  const channel = 'files';

  const rowY = (i: number): number => 70 + i * 44;

  const drawRows = (): void => {
    if (!rowsGroup) return;
    rowsGroup.replaceChildren();
    subs.forEach((sub, i) => {
      const y = rowY(i);

      const cbDot = document.createElementNS(NS, 'circle');
      cbDot.setAttribute('cx', '120');
      cbDot.setAttribute('cy', String(y));
      cbDot.setAttribute('r', '14');
      cbDot.classList.add('client-node');
      if (!sub.alive) cbDot.classList.add('client-node--gone');
      rowsGroup.appendChild(cbDot);

      const cbLabel = document.createElementNS(NS, 'text');
      cbLabel.setAttribute('x', '120');
      cbLabel.setAttribute('y', String(y + 4));
      cbLabel.setAttribute('text-anchor', 'middle');
      cbLabel.classList.add('client-label');
      cbLabel.textContent = sub.cbLabel;
      rowsGroup.appendChild(cbLabel);

      if (sub.alive || sub.leaked) {
        const wrapperRect = document.createElementNS(NS, 'rect');
        wrapperRect.setAttribute('x', '440');
        wrapperRect.setAttribute('y', String(y - 14));
        wrapperRect.setAttribute('width', '120');
        wrapperRect.setAttribute('height', '28');
        wrapperRect.setAttribute('rx', '6');
        wrapperRect.classList.add('wrapper-box');
        if (sub.leaked) wrapperRect.classList.add('wrapper-box--leaked');
        rowsGroup.appendChild(wrapperRect);

        const wrapperLabel = document.createElementNS(NS, 'text');
        wrapperLabel.setAttribute('x', '500');
        wrapperLabel.setAttribute('y', String(y + 4));
        wrapperLabel.setAttribute('text-anchor', 'middle');
        wrapperLabel.classList.add('wrapper-label');
        wrapperLabel.textContent = `wrapper(${sub.cbLabel})`;
        rowsGroup.appendChild(wrapperLabel);

        const link = document.createElementNS(NS, 'line');
        link.setAttribute('x1', '134');
        link.setAttribute('y1', String(y));
        link.setAttribute('x2', '440');
        link.setAttribute('y2', String(y));
        link.classList.add('link');
        if (sub.leaked) link.classList.add('link--orphan');
        else if (sub.alive) link.classList.add('link--active');
        rowsGroup.appendChild(link);
      }
    });
  };

  const drawCounts = (): void => {
    const count = scene.listenerCount(channel);
    const activeCount = subs.filter((s) => s.alive && !s.released).length;
    if (emitterCount) emitterCount.textContent = String(count);
    if (modeStateNode) {
      modeStateNode.dataset.value = scene.mode;
      modeStateNode.textContent = '';
      modeStateNode.append(
        'mode: ',
        Object.assign(document.createElement('strong'), { textContent: scene.mode }),
      );
    }
    if (listenerCountNode) {
      listenerCountNode.textContent = '';
      listenerCountNode.append(
        'listeners on files: ',
        Object.assign(document.createElement('strong'), { textContent: String(count) }),
      );
    }
    if (activeCountNode) {
      activeCountNode.textContent = '';
      activeCountNode.append(
        'active in caller: ',
        Object.assign(document.createElement('strong'), { textContent: String(activeCount) }),
      );
    }
    if (callCountNode) {
      callCountNode.textContent = '';
      callCountNode.append(
        'last trigger fired: ',
        Object.assign(document.createElement('strong'), {
          textContent: String(lastTriggerCalls),
        }),
        ' callbacks (total ',
        Object.assign(document.createElement('strong'), { textContent: String(totalCalls) }),
        ')',
      );
    }
  };

  const drawSubscriptionList = (): void => {
    if (!subscriptionList) return;
    subscriptionList.replaceChildren();
    subs.forEach((sub) => {
      const row = document.createElement('div');
      row.dataset.role = 'subscription-row';
      row.dataset.alive = String(sub.alive);
      row.dataset.leaked = String(sub.leaked);
      row.dataset.released = String(sub.released);

      const label = document.createElement('span');
      label.textContent = `${sub.cbLabel} — registered in `;
      const modeMark = document.createElement('strong');
      modeMark.textContent = sub.modeAtSubscribe;
      label.appendChild(modeMark);
      if (sub.released) {
        const releasedNote = document.createElement('em');
        releasedNote.textContent = ' — caller dropped its reference, wrapper still firing';
        releasedNote.classList.add('leak-note');
        label.appendChild(releasedNote);
      } else if (sub.leaked) {
        const leakNote = document.createElement('em');
        leakNote.textContent = ' — cleanup ran but listener still attached';
        leakNote.classList.add('leak-note');
        label.appendChild(leakNote);
      } else if (!sub.alive) {
        label.append(' — removed');
      }
      row.appendChild(label);

      if (sub.alive && !sub.released) {
        const offBtn = document.createElement('button');
        offBtn.type = 'button';
        offBtn.dataset.action = 'cleanup';
        offBtn.textContent = sub.leaked ? 'press cleanup again' : 'press cleanup';
        offBtn.addEventListener('click', () => {
          sub.off();
          refresh();
        });
        row.appendChild(offBtn);

        const dropBtn = document.createElement('button');
        dropBtn.type = 'button';
        dropBtn.dataset.action = 'drop';
        dropBtn.textContent = 'drop reference';
        dropBtn.addEventListener('click', () => {
          sub.released = true;
          sub.off = () => {};
          refresh();
        });
        row.appendChild(dropBtn);
      } else if (sub.leaked && !sub.released) {
        const offBtn = document.createElement('button');
        offBtn.type = 'button';
        offBtn.dataset.action = 'cleanup';
        offBtn.textContent = 'press cleanup again';
        offBtn.addEventListener('click', () => {
          sub.off();
          refresh();
        });
        row.appendChild(offBtn);
      }

      subscriptionList.appendChild(row);
    });
  };

  const setCaption = (): void => {
    if (!captionNode) return;
    if (scene.mode === 'closure') {
      captionNode.innerHTML =
        '<strong>closure mode.</strong> the cleanup function captures the wrapper. when you press it, the wrapper comes off the emitter cleanly.';
    } else {
      captionNode.innerHTML =
        '<strong>direct mode.</strong> the cleanup function tries to remove <code>cb</code> instead of the wrapper. <code>cb</code> was never on the emitter, so nothing comes off and the listener leaks.';
    }
  };

  const refresh = (): void => {
    drawRows();
    drawCounts();
    drawSubscriptionList();
    setCaption();
  };

  const appendTransition = (t: Transition): void => {
    if (!log) return;
    const entry = document.createElement('div');
    entry.dataset.role = 'transition-entry';
    entry.dataset.kind = t.kind;
    const channelText = t.channel !== undefined ? ` on ${t.channel}` : '';
    entry.textContent = `${t.kind}${channelText}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  };

  let pendingCleanup: number | null = null;

  scene.onTransition(appendTransition);
  scene.onTransition((t) => {
    if (t.kind === 'cleanup') {
      const target = subs.find((s) => s.id === pendingCleanup);
      if (target) {
        target.alive = false;
        target.leaked = false;
      }
    } else if (t.kind === 'leakedCleanup') {
      const target = subs.find((s) => s.id === pendingCleanup);
      if (target) {
        target.alive = false;
        target.leaked = true;
      }
    }
  });

  el.querySelector<HTMLButtonElement>('[data-action="subscribe"]')?.addEventListener(
    'click',
    () => {
      const id = nextId++;
      const cbLabel = `cb${String(id)}`;
      const callTrack = (): void => {
        totalCalls += 1;
        lastTriggerCalls += 1;
      };
      const sceneOff = scene.subscribe(channel, callTrack);
      const sub: SubscriptionRow = {
        id,
        cbLabel,
        modeAtSubscribe: scene.mode,
        off: () => {
          pendingCleanup = id;
          sceneOff();
          pendingCleanup = null;
        },
        alive: true,
        leaked: false,
        released: false,
      };
      subs.push(sub);
      refresh();
    },
  );

  el.querySelector<HTMLButtonElement>('[data-action="trigger"]')?.addEventListener('click', () => {
    lastTriggerCalls = 0;
    scene.trigger(channel);
    refresh();
  });

  el.querySelector<HTMLButtonElement>('[data-action="set-mode"]')?.addEventListener('click', () => {
    scene.setMode(scene.mode === 'closure' ? 'direct' : 'closure');
    refresh();
  });

  el.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', () => {
    scene.reset();
    subs.length = 0;
    nextId = 1;
    totalCalls = 0;
    lastTriggerCalls = 0;
    if (log) log.replaceChildren();
    refresh();
  });

  refresh();
}
