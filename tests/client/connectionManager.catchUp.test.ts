import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

// Builds a manager with one ready subscription on 'files' holding doc1 and
// doc2, then kills the socket and lets it reopen and resubscribe.
async function droppedAndReopened() {
  const socket = ClientSocketWrapper.createNull();
  const manager = new ConnectionManager(socket);
  await socket.connect();
  const messages = socket.trackMessages();

  const handle = manager.subscribe('files.all');
  const subscriptionId = (messages.data[0] as SubscribeMsg).id;
  const server = socket.simulateServer();
  server.send({ type: 'added', collection: 'files', id: 'doc1', fields: { name: 'one' } });
  server.send({ type: 'ready', id: subscriptionId, collection: 'files' });
  await handle.ready;
  server.send({ type: 'added', collection: 'files', id: 'doc2', fields: { name: 'two' } });

  server.simulateClose();
  await vi.advanceTimersByTimeAsync(50);

  return { socket, manager, subscriptionId };
}

describe('ConnectionManager - the store catches up after resubscribe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the ready after resubscribe replaces the store: a doc deleted while offline is gone', async () => {
    vi.useFakeTimers();
    const { socket, manager, subscriptionId } = await droppedAndReopened();
    const server = socket.simulateServer();

    // The server's new truth: doc1 was deleted during the outage.
    server.send({ type: 'added', collection: 'files', id: 'doc2', fields: { name: 'two' } });
    server.send({ type: 'added', collection: 'files', id: 'doc3', fields: { name: 'three' } });
    server.send({ type: 'ready', id: subscriptionId, collection: 'files' });

    expect(manager.store('files').getAll()).toEqual([
      { _id: 'doc2', name: 'two' },
      { _id: 'doc3', name: 'three' },
    ]);
  });

  it('keeps the stale view on screen until the replacement ready lands', async () => {
    vi.useFakeTimers();
    const { socket, manager } = await droppedAndReopened();
    const server = socket.simulateServer();

    server.send({ type: 'added', collection: 'files', id: 'doc2', fields: { name: 'two v2' } });
    server.send({ type: 'added', collection: 'files', id: 'doc3', fields: { name: 'three' } });

    expect(manager.store('files').getAll()).toEqual([
      { _id: 'doc1', name: 'one' },
      { _id: 'doc2', name: 'two' },
    ]);
  });

  it('never lets a change event expose an empty store during the swap', async () => {
    vi.useFakeTimers();
    const { socket, manager, subscriptionId } = await droppedAndReopened();
    const store = manager.store('files');
    const sizesSeen: number[] = [];
    store.onChange(() => sizesSeen.push(store.getAll().length));
    const server = socket.simulateServer();

    server.send({ type: 'added', collection: 'files', id: 'doc2', fields: { name: 'two' } });
    server.send({ type: 'added', collection: 'files', id: 'doc3', fields: { name: 'three' } });
    server.send({ type: 'ready', id: subscriptionId, collection: 'files' });

    expect(sizesSeen.length).toBeGreaterThan(0);
    expect(sizesSeen).not.toContain(0);
  });

  it('live updates flow again once the catch up completes', async () => {
    vi.useFakeTimers();
    const { socket, manager, subscriptionId } = await droppedAndReopened();
    const server = socket.simulateServer();

    server.send({ type: 'added', collection: 'files', id: 'doc2', fields: { name: 'two' } });
    server.send({ type: 'ready', id: subscriptionId, collection: 'files' });
    server.send({ type: 'changed', collection: 'files', id: 'doc2', fields: { name: 'two v2' } });
    server.send({ type: 'added', collection: 'files', id: 'doc4', fields: { name: 'four' } });

    expect(manager.store('files').getAll()).toEqual([
      { _id: 'doc2', name: 'two v2' },
      { _id: 'doc4', name: 'four' },
    ]);
  });
});
