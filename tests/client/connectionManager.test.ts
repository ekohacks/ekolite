import { describe, expect, it } from 'vitest';
import { ClientSocketWrapper } from '../../client/clientSocket.ts';
import { ConnectionManager } from '../../client/connectionManager.ts';
import { SubscribeMsg } from '../../shared/protocol.ts';

describe('ConnectionManager', () => {
  it('subscribe sends a subscribe message and routes added documents into the store', async () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const server = socket.simulateServer();

    const handle = manager.subscribe('files.all');

    // Manager sent the subscribe message.
    expect(messages.data).toHaveLength(1);
    const sent = messages.data[0] as SubscribeMsg;
    expect(sent.type).toBe('subscribe');
    expect(sent.name).toBe('files.all');

    // Simulate the server responding.
    server.send({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });
    server.send({ type: 'ready', id: sent.id });

    await handle.ready;

    expect(manager.store('files').getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
  });

  it('rejects ready when subscribe fails on the server', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();

    const handle = manager.subscribe('nope');
    const sent = messages.data[0] as SubscribeMsg;

    server.send({
      type: 'error',
      id: sent.id,
      error: { code: 404, message: 'Unknown publication' },
    });

    await expect(handle.ready).rejects.toMatchObject({ code: 404 });
  });

  it('handle.stop sends an unsubscribe to the server', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();

    const handle = manager.subscribe('files.all');
    const subId = (messages.data[0] as SubscribeMsg).id;

    server.send({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });
    server.send({ type: 'ready', id: subId });
    await handle.ready;

    handle.stop();

    const unsub = messages.data.find((m) => (m as { type: string }).type === 'unsubscribe');
    expect(unsub).toEqual({ type: 'unsubscribe', id: subId });
  });

  it('stop releases subscription bookkeeping', () => {
    const socket = ClientSocketWrapper.createNull();
    const manager = new ConnectionManager(socket);
    const handle = manager.subscribe('files.all');

    handle.stop();

    expect(manager.activeSubscriptionCount()).toBe(0);
  });

  it('after dispose, server data does not mutate manager stores', async () => {
    const socket = ClientSocketWrapper.createNull();
    const server = socket.simulateServer();
    const manager = new ConnectionManager(socket);
    const messages = socket.trackMessages();
    const store = manager.store('files');

    const handle = manager.subscribe('files.all');
    server.send({ type: 'ready', id: (messages.data[0] as SubscribeMsg).id });
    await handle.ready;

    manager.dispose();

    expect(manager.activeSubscriptionCount()).toBe(0);

    server.send({
      type: 'added',
      collection: 'files',
      id: 'late',
      fields: { name: 'x.bam' },
    });

    expect(store.getById('late')).toBeUndefined();
  });
});
