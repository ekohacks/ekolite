// EkoLite live demo — the same client stack as demo.ts, but talking to a real
// server over a real socket instead of a stubbed one.
//
// The only line that differs from the stubbed demo is the socket: createNull()
// becomes create('ws://localhost:3001/ws'). Everything else (ConnectionManager,
// SubscriptionHandle, ReactiveStore) is identical. That is the Nullables payoff.
//
// It shows the read side (subscribe, see the documents, watch the list update as the
// files collection changes) plus one write: uploading a file. The upload is a plain
// HTTP POST to /api/files, which stores the bytes and inserts a document, so the file
// then streams back into the list through the same subscription.

import { ClientSocketWrapper } from '../clientSocket.ts';
import { ConnectionManager } from '../connectionManager.ts';

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}

function input(id: string): HTMLInputElement {
  const node = el(id);
  if (!(node instanceof HTMLInputElement)) {
    throw new Error(`#${id} is not an input`);
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

// 4. Upload a file over HTTP. It hits the server, lands on disk and inserts a
// document, which streams back into the list above through the subscription.
const fileInput = input('file');
const uploadBtn = button('upload');

uploadBtn.addEventListener('click', () => {
  const file = fileInput.files?.[0];
  if (!file) {
    log('pick a file first');
    return;
  }
  const form = new FormData();
  form.append('file', file, file.name);
  log(`out: upload ${file.name}`);
  // POST through the vite proxy (/api → :3001) so it stays same-origin, no CORS.
  void fetch('/api/files', { method: 'POST', body: form })
    .then((res) => {
      log(res.ok ? `in: stored ${file.name}` : `upload failed: ${String(res.status)}`);
      if (res.ok) {
        fileInput.value = '';
      }
    })
    .catch((err: unknown) => {
      log(`upload error: ${err instanceof Error ? err.message : String(err)}`);
    });
});

socket.onClose(() => {
  statusEl.textContent = 'disconnected · ConnectionManager disposed';
  uploadBtn.disabled = true;
  log('socket closed → dispose()');
});
