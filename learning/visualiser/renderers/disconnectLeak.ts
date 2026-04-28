import type { DisconnectLeakScene, Transition } from '../scenes/disconnectLeak.ts';

const NS = 'http://www.w3.org/2000/svg';

export function renderDisconnectLeakScene(scene: DisconnectLeakScene, el: HTMLElement): void {
  el.innerHTML = `
    <svg class="canvas" viewBox="0 0 600 280" data-role="canvas" preserveAspectRatio="xMidYMid meet">
      <text x="120" y="34" class="lane-label" text-anchor="middle">clients</text>
      <text x="480" y="34" class="lane-label" text-anchor="middle">mongo emitter (files)</text>
      <rect class="emitter-box" x="420" y="60" width="120" height="180" rx="8" />
      <text class="emitter-count" data-role="emitter-count" x="480" y="160" text-anchor="middle">0</text>
      <text class="emitter-caption" x="480" y="190" text-anchor="middle">listeners</text>
      <g data-role="clients"></g>
      <g data-role="links"></g>
    </svg>
    <div class="row">
      <button data-action="connect" type="button">Connect client</button>
      <button data-action="subscribe" type="button">Subscribe</button>
      <button data-action="disconnect" type="button">Disconnect</button>
      <button data-action="set-fix" type="button">Toggle fix</button>
    </div>
    <div class="row">
      <span data-role="client-count"></span>
      <span data-role="watcher-count"></span>
      <span data-role="fix-state"></span>
    </div>
    <div class="row" data-role="client-row"></div>
    <div class="stack" data-role="transition-log"></div>
  `;

  const clientsGroup = el.querySelector<SVGGElement>('[data-role="clients"]');
  const linksGroup = el.querySelector<SVGGElement>('[data-role="links"]');
  const emitterCount = el.querySelector<SVGTextElement>('[data-role="emitter-count"]');
  const clientCountNode = el.querySelector<HTMLElement>('[data-role="client-count"]');
  const watcherCountNode = el.querySelector<HTMLElement>('[data-role="watcher-count"]');
  const fixStateNode = el.querySelector<HTMLElement>('[data-role="fix-state"]');
  const clientRow = el.querySelector<HTMLElement>('[data-role="client-row"]');
  const log = el.querySelector<HTMLElement>('[data-role="transition-log"]');

  type Slot = { id: string | null; subscribed: boolean; orphan: boolean };
  const slots: Slot[] = Array.from({ length: 5 }, () => ({
    id: null,
    subscribed: false,
    orphan: false,
  }));

  let lastClientId: string | null = null;

  const allocSlot = (id: string): number => {
    const idx = slots.findIndex((s) => s.id === null && !s.orphan);
    const target = idx === -1 ? slots.findIndex((s) => s.id === null) : idx;
    if (target === -1) return 0;
    slots[target] = { id, subscribed: false, orphan: false };
    return target;
  };

  const findSlot = (id: string): number => slots.findIndex((s) => s.id === id);

  const slotY = (i: number): number => 70 + i * 36;

  const drawClients = (): void => {
    if (!clientsGroup) return;
    clientsGroup.replaceChildren();
    slots.forEach((slot, i) => {
      if (slot.id === null && !slot.orphan) return;
      const y = slotY(i);

      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', '120');
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '14');
      dot.classList.add('client-node');
      if (slot.id === null) dot.classList.add('client-node--gone');
      clientsGroup.appendChild(dot);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', '120');
      label.setAttribute('y', String(y + 4));
      label.setAttribute('text-anchor', 'middle');
      label.classList.add('client-label');
      label.textContent = slot.id !== null ? `c${slot.id}` : '×';
      clientsGroup.appendChild(label);
    });
  };

  const drawLinks = (): void => {
    if (!linksGroup) return;
    linksGroup.replaceChildren();
    slots.forEach((slot, i) => {
      if (!slot.subscribed && !slot.orphan) return;
      const y = slotY(i);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', '134');
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', '420');
      line.setAttribute('y2', String(y));
      line.classList.add('link');
      if (slot.orphan) line.classList.add('link--orphan');
      else if (slot.subscribed) line.classList.add('link--active');
      linksGroup.appendChild(line);
    });
  };

  const drawCounts = (): void => {
    const watchers = scene.watcherCount('files');
    if (emitterCount) emitterCount.textContent = String(watchers);
    if (clientCountNode) {
      clientCountNode.textContent = '';
      clientCountNode.append(
        'clients: ',
        Object.assign(document.createElement('strong'), {
          textContent: String(scene.clientCount),
        }),
      );
    }
    if (watcherCountNode) {
      watcherCountNode.textContent = '';
      watcherCountNode.append(
        'watchers on files: ',
        Object.assign(document.createElement('strong'), { textContent: String(watchers) }),
      );
    }
    if (fixStateNode) {
      fixStateNode.dataset.value = scene.fix;
      fixStateNode.textContent = '';
      fixStateNode.append(
        'fix: ',
        Object.assign(document.createElement('strong'), { textContent: scene.fix }),
      );
    }
    if (clientRow) {
      clientRow.replaceChildren();
      for (const id of scene.clientIds) {
        const dot = document.createElement('span');
        dot.dataset.role = 'client-dot';
        dot.textContent = `c${id}`;
        clientRow.appendChild(dot);
      }
    }
  };

  const appendTransition = (t: Transition): void => {
    if (!log) return;
    const entry = document.createElement('div');
    entry.dataset.role = 'transition-entry';
    entry.dataset.kind = t.kind;
    entry.textContent = t.clientId !== undefined ? `${t.kind} c${t.clientId}` : t.kind;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  };

  scene.onTransition(appendTransition);

  const refresh = (): void => {
    drawClients();
    drawLinks();
    drawCounts();
  };

  const pickClient = (): string | undefined => {
    if (lastClientId !== null) return lastClientId;
    const ids = scene.clientIds;
    return ids.length > 0 ? ids[ids.length - 1] : undefined;
  };

  el.querySelector<HTMLButtonElement>('[data-action="connect"]')?.addEventListener('click', () => {
    const id = scene.connectClient();
    allocSlot(id);
    lastClientId = id;
    refresh();
  });

  el.querySelector<HTMLButtonElement>('[data-action="subscribe"]')?.addEventListener(
    'click',
    () => {
      const id = pickClient();
      if (id === undefined) return;
      const slotIdx = findSlot(id);
      if (slotIdx >= 0) slots[slotIdx].subscribed = true;
      scene.subscribe(id, `sub-${id}`, 'files');
      refresh();
    },
  );

  el.querySelector<HTMLButtonElement>('[data-action="disconnect"]')?.addEventListener(
    'click',
    () => {
      const id = pickClient();
      if (id === undefined) return;
      const slotIdx = findSlot(id);
      const wasSubscribed = slotIdx >= 0 && slots[slotIdx].subscribed;
      const fixWas = scene.fix;
      scene.disconnect(id);
      if (slotIdx >= 0) {
        slots[slotIdx].id = null;
        slots[slotIdx].subscribed = false;
        if (wasSubscribed && fixWas === 'off') {
          slots[slotIdx].orphan = true;
        }
      }
      lastClientId = null;
      refresh();
    },
  );

  el.querySelector<HTMLButtonElement>('[data-action="set-fix"]')?.addEventListener('click', () => {
    scene.setFix(scene.fix === 'on' ? 'off' : 'on');
    refresh();
  });

  refresh();
}
