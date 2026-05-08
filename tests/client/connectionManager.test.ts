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

  it('handle.stop sends an unsubscribe and stops further messages reaching the store', async () => {
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

    // Manager sent an unsubscribe for the right id.
    const unsub = messages.data.find((m) => (m as { type: string }).type === 'unsubscribe');
    expect(unsub).toEqual({ type: 'unsubscribe', id: subId });

    // After stop, late server messages do not mutate the store.
    server.send({
      type: 'changed',
      collection: 'files',
      id: '1',
      fields: { name: 'late.bam' },
    });

    expect(manager.store('files').getById('1')).toEqual({ _id: '1', name: 'existing.bam' });
  });
});
