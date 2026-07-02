// EkoLite live demo — the same client stack as demo.ts, but talking to a real
// server over a real socket instead of a stubbed one.
//
// The only line that differs from the stubbed demo is the socket: createNull()
// becomes create('ws://localhost:3001/ws'). Everything else (ConnectionManager,
// SubscriptionHandle, ReactiveStore) is identical. That is the Nullables payoff.
//
// It shows the read side (subscribe, see the documents, watch the list update as the
// files collection changes) plus one write: uploading a file through the real Uploader
// surface. upload() POSTs to /api/files; on success the file streams back into the list
// through the same subscription, and on a refusal it rejects with the server's error so
// the demo can show it rather than swallow it.

import { ClientSocketWrapper } from '../clientSocket.ts';
import { ConnectionManager } from '../connectionManager.ts';
import { Uploader } from '../uploader.ts';
import { RpcError } from '../../shared/types.ts';

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

function progressBar(id: string): HTMLProgressElement {
  const node = el(id);
  if (!(node instanceof HTMLProgressElement)) {
    throw new Error(`#${id} is not a progress element`);
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
      const count = typeof doc.countC === 'number' ? ` · C: ${String(doc.countC)}` : '';

      const label = document.createElement('span');
      label.textContent = `${doc._id} · ${name}${count}`;

      // Call runCountC on this file over the socket. The server counts, writes the
      // count onto the document, and it streams back into this same store, so the
      // number appears on re-render with no extra wiring here.
      const countBtn = document.createElement('button');
      countBtn.textContent = 'Count C';
      countBtn.addEventListener('click', () => {
        log(`out: runCountC ${doc._id}`);
        void manager
          .call('runCountC', doc._id)
          .then((result) => {
            log(`in: runCountC ${doc._id} → ${String(result)}`);
          })
          .catch((err: unknown) => {
            log(`runCountC error: ${err instanceof Error ? err.message : String(err)}`);
          });
      });

      item.append(label, ' ', countBtn);
      return item;
    }),
  );
}

render();
files.onChange(() => {
  log('in: store changed');
  render();
});

// 4. Upload a file through the real Uploader surface. The same code runs in
// production; only create() differs from the nulled uploader the tests drive. The
// request goes to the relative /api/files, so it rides the vite proxy (/api → :3001)
// and stays same-origin. The bar is fed by the { percent } signal from onProgress:
// reset on each upload, filled as the bytes climb, cleared on success or refusal.
const uploader = Uploader.create();
const fileInput = input('file');
const uploadBtn = button('upload');
const uploadProgress = progressBar('progress');

uploadBtn.addEventListener('click', () => {
  const file = fileInput.files?.[0];
  if (!file) {
    log('pick a file first');
    return;
  }
  log(`out: upload ${file.name}`);
  uploadProgress.value = 0;
  uploadProgress.hidden = false;
  void uploader
    .upload(file, {
      onProgress: ({ percent }) => {
        uploadProgress.value = percent;
        log(`upload progress: ${String(percent)}%`);
      },
    })
    .then((stored) => {
      log(`in: stored ${stored.name} (${stored.id})`);
      fileInput.value = '';
    })
    .catch((err: unknown) => {
      if (err instanceof RpcError) {
        log(`upload refused: ${String(err.code)} ${err.message}`);
      } else {
        log(`upload error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
    .finally(() => {
      uploadProgress.hidden = true;
    });
});

socket.onClose(() => {
  statusEl.textContent = 'disconnected · ConnectionManager disposed';
  uploadBtn.disabled = true;
  log('socket closed → dispose()');
});
