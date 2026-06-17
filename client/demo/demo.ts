// EkoLite client demo — the whole client stack, no backend.
//
// It uses the framework's own Nullables seam: ClientSocketWrapper.createNull()
// gives a socket with no network, and simulateServer() lets us play the server
// by hand. ConnectionManager, SubscriptionHandle and ReactiveStore are the real
// thing. Swap createNull() for ClientSocketWrapper.create('wss://host/ws') and
// this same code talks to a real server.

import { ClientSocketWrapper } from '../clientSocket.ts';
import { ConnectionManager } from '../connectionManager.ts';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}

function button(id: string): HTMLButtonElement {
  const node = el(id);
  if (!(node instanceof HTMLButtonElement)) {
    throw new Error(`#${id} is not a button`);
  }
  return node;
}

const statusEl = el('status');
const listEl = el('list');
const logEl = el('log');
const addBtn = button('add');
const renameBtn = button('rename');
const removeBtn = button('remove');
const disconnectBtn = button('disconnect');

function log(line: string): void {
  const entry = document.createElement('div');
  entry.textContent = line;
  logEl.prepend(entry);
}

// The subscription id is generated inside subscribe(); read it back off the
// outbound tracker so the stubbed server can address its ready to it.
function subscribeIdFrom(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      'id' in message &&
      message.type === 'subscribe' &&
      typeof message.id === 'string'
    ) {
      return message.id;
    }
  }
  throw new Error('No subscribe message recorded yet');
}

// 1. Wire the client to a stubbed server (no network, no Mongo).
const socket = ClientSocketWrapper.createNull();
await socket.connect();
const manager = new ConnectionManager(socket);
const server = socket.simulateServer();
const outbound = socket.trackMessages();

// 2. Subscribe to a publication by name.
const handle = manager.subscribe('files.byFolder', { folderId: 'folder-a' });
const subId = subscribeIdFrom(outbound.data);
log(`out: subscribe files.byFolder (${subId.slice(0, 8)})`);

// 3. The server answers the way a real one would: initial docs, then ready.
server.send({ type: 'added', collection: 'files', id: '1', fields: { name: 'report.pdf' } });
server.send({ type: 'added', collection: 'files', id: '2', fields: { name: 'notes.md' } });
server.send({ type: 'ready', id: subId, collection: 'files' });
log('in: added x2, ready');

await handle.ready;
statusEl.textContent = 'connected · subscription ready';

// 4. Read the store and re-render on every change. This is the reactive bit.
const files = manager.store('files');

function render(): void {
  const docs = files.getAll();
  listEl.replaceChildren(
    ...docs.map((doc) => {
      const item = document.createElement('li');
      const name = typeof doc.name === 'string' ? doc.name : '';
      item.textContent = `${doc._id} · ${name}`;
      return item;
    }),
  );
}

render();
files.onChange(render);

// 5. Drive live updates exactly as the server would over a real socket.
let nextId = 3;

addBtn.addEventListener('click', () => {
  const id = String(nextId);
  nextId += 1;
  server.send({ type: 'added', collection: 'files', id, fields: { name: `file-${id}.txt` } });
  log(`in: added ${id}`);
});

renameBtn.addEventListener('click', () => {
  const docs = files.getAll();
  if (docs.length === 0) {
    return;
  }
  const id = docs[0]._id;
  server.send({ type: 'changed', collection: 'files', id, fields: { name: 'renamed.txt' } });
  log(`in: changed ${id}`);
});

removeBtn.addEventListener('click', () => {
  const docs = files.getAll();
  if (docs.length === 0) {
    return;
  }
  const id = docs[0]._id;
  server.send({ type: 'removed', collection: 'files', id });
  log(`in: removed ${id}`);
});

disconnectBtn.addEventListener('click', () => {
  server.simulateClose();
});

socket.onClose(() => {
  statusEl.textContent = 'disconnected · ConnectionManager disposed';
  for (const btn of [addBtn, renameBtn, removeBtn, disconnectBtn]) {
    btn.disabled = true;
  }
  log('socket closed → dispose()');
});
