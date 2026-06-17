// EkoLite live demo — the same client stack as demo.ts, but talking to a real
// server over a real socket instead of a stubbed one.
//
// The only line that differs from the stubbed demo is the socket: createNull()
// becomes create('ws://localhost:3001/ws'). Everything else (ConnectionManager,
// SubscriptionHandle, ReactiveStore) is identical. That is the Nullables payoff.
//
// This shows the read side: subscribe, see the initial documents, and watch the
// list update live as the files collection changes in Mongo. Writing from the
// browser needs the methods/RPC path, which is not wired yet, so there are no
// mutation buttons here. Change data with mongosh and watch it stream in.

import { ClientSocketWrapper } from '../clientSocket.ts';
import { ConnectionManager } from '../connectionManager.ts';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}

const statusEl = el('status');
const listEl = el('list');
const logEl = el('log');

function log(line: string): void {
  const entry = document.createElement('div');
  entry.textContent = line;
  logEl.prepend(entry);
}

// 1. Wire the client to the real server. Swap this URL for your host in production.
const socket = ClientSocketWrapper.create('ws://localhost:3001/ws');

try {
  await socket.connect();
} catch {
  statusEl.textContent = 'could not connect — is the server running? (npm run dev:server)';
  throw new Error('connection failed');
}

statusEl.textContent = 'connected · subscribing…';
const manager = new ConnectionManager(socket);

// 2. Subscribe to a publication the server defines (see server/start.ts).
const handle = manager.subscribe('files.all');
log('out: subscribe files.all');

await handle.ready;
statusEl.textContent = 'connected · subscription ready';
log('in: ready');

// 3. Read the store and re-render on every change. Real documents, live from Mongo.
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
files.onChange(() => {
  log('in: store changed');
  render();
});

socket.onClose(() => {
  statusEl.textContent = 'disconnected · ConnectionManager disposed';
  log('socket closed → dispose()');
});
