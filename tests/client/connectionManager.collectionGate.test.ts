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
  it('routes data when the publication name is not the collection name', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const store = manager.store('files');
    await socket.connect();

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
    server.send({ type: 'ready', id: subId, collection: 'files' });

    // ready resolves, so the app believes the subscription is healthy. That is
    // what makes the data loss silent.
    await handle.ready;

    expect(store.getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
  });

  it('routes data when the name prefix differs from the collection', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const store = manager.store('archive');
    await socket.connect();

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
    server.send({ type: 'ready', id: subId, collection: 'archive' });
    await handle.ready;

    expect(store.getById('1')).toEqual({ _id: '1', name: 'old.bam' });
  });

  // The single-sub tests above prove the name guess loses data. This one pins
  // the contract once more than one subscription is in flight: two subs over
  // two different collections, each learning its own collection from its own
  // `ready`. Stopping one sub must close the gate for its collection alone and
  // leave the other sub's collection live, so late data for the stopped
  // collection is dropped while the live one keeps flowing.
  it('stopping one of two live subscriptions gates only that collection, not the other', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const files = manager.store('files');
    const archive = manager.store('archive');
    await socket.connect();

    // Both subscriptions are outstanding before any server reply, and neither
    // publication name starts with the collection it actually reads from.
    const filesHandle = manager.subscribe('recentFiles');
    const archiveHandle = manager.subscribe('oldArchive');
    const filesSubId = (messages.data[0] as SubscribeMsg).id;
    const archiveSubId = (messages.data[1] as SubscribeMsg).id;

    // Each ready names the collection its sub owns, so the two stay distinct
    // regardless of how their data interleaves on the wire.
    server.send({ type: 'added', collection: 'files', id: 'f1', fields: { name: 'a.bam' } });
    server.send({ type: 'ready', id: filesSubId, collection: 'files' });
    server.send({ type: 'added', collection: 'archive', id: 'a1', fields: { name: 'b.bam' } });
    server.send({ type: 'ready', id: archiveSubId, collection: 'archive' });

    await filesHandle.ready;
    await archiveHandle.ready;

    // Both collections were learned from the server and routed to their store.
    expect(files.getById('f1')).toEqual({ _id: 'f1', name: 'a.bam' });
    expect(archive.getById('a1')).toEqual({ _id: 'a1', name: 'b.bam' });

    // Stop the files subscription only. archive stays live.
    filesHandle.stop();

    // Late data for the stopped collection is gated...
    server.send({ type: 'changed', collection: 'files', id: 'f1', fields: { name: 'late.bam' } });
    // ...while data for the still-live collection keeps flowing.
    server.send({
      type: 'changed',
      collection: 'archive',
      id: 'a1',
      fields: { name: 'fresh.bam' },
    });

    expect(files.getById('f1')).toEqual({ _id: 'f1', name: 'a.bam' });
    expect(archive.getById('a1')).toEqual({ _id: 'a1', name: 'fresh.bam' });
  });
});

// The tests above let the client learn the collection from inbound data. This
// pins the protocol decision instead: `ready` carries the collection the
// subscription owns, and that is the authoritative source. Here the
// publication's initial result set is empty, so there is no `added` to learn
// from, and the name ('recentFiles') is not the collection ('files'). The only
// place the collection can come from is `ready.collection`. That also rules out
// a purely client-side buffer that learns from the first `added`: no `added`
// arrives before `ready`, so such a client could never bind the collection.
describe('ConnectionManager learns its collection from ready', () => {
  it('routes live data using the collection named in ready, with no initial data', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const store = manager.store('files');
    await socket.connect();

    const handle = manager.subscribe('recentFiles');
    const subId = (messages.data[0] as SubscribeMsg).id;

    // ready names the collection the sub owns. With no initial `added`, this is
    // the only place the collection can come from.
    server.send({ type: 'ready', id: subId, collection: 'files' });
    await handle.ready;

    // A document enters the result set live, after ready. It can only route if
    // the sub already learned it owns 'files' from the ready message.
    server.send({ type: 'added', collection: 'files', id: 'x', fields: { name: 'live.bam' } });

    expect(store.getById('x')).toEqual({ _id: 'x', name: 'live.bam' });
  });
});
