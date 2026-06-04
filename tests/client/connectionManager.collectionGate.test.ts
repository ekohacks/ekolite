import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

// These tests pin the contract the gate quietly depends on: the collection a
// subscription owns is decided by the server, not by the shape of the
// publication name. The gate currently guesses the collection from the name
// (name.split('.')[0]), so a publication whose name does not start with its
// collection is dropped on the floor with no error. Both tests are RED on the
// branch and turn GREEN once the client stops guessing the collection.
describe('ConnectionManager collection gate', () => {
  it.fails('routes data when the publication name is not the collection name', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const store = manager.store('files');

    // A publication named for what it returns, not for its collection. On the
    // server this maps to { collection: 'files', query: {...} }.
    const handle = manager.subscribe('recentFiles');
    const subId = (messages.data[0] as SubscribeMsg).id;

    // The server publishes into the collection it actually owns: 'files'.
    server.send({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });
    server.send({ type: 'ready', id: subId });

    // ready resolves, so the app believes the subscription is healthy. That is
    // what makes the data loss silent.
    await handle.ready;

    expect(store.getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
  });

  it.fails('routes data when the name prefix differs from the collection', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const store = manager.store('archive');

    // Dotted name, but the first segment ('files') is not the collection the
    // publication reads from ('archive').
    const handle = manager.subscribe('files.archived');
    const subId = (messages.data[0] as SubscribeMsg).id;

    server.send({
      type: 'added',
      collection: 'archive',
      id: '1',
      fields: { name: 'old.bam' },
    });
    server.send({ type: 'ready', id: subId });
    await handle.ready;

    expect(store.getById('1')).toEqual({ _id: '1', name: 'old.bam' });
  });
});
