import { describe, it, expect, vi } from 'vitest';
import { Publications } from '../../server/logic/publications.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

describe('Publications', () => {
  it('sends error when subscribing to unknown publication', async () => {
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'nonexistent',
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'sub1',
      error: { code: 404, message: 'Unknown publication: nonexistent' },
    });
  });

  it('notifies observer on failed subscribe for unknown publication', async () => {
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = { onMessage: vi.fn() };
    const pubs = new Publications(mongo, ws, observer);

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'nonexistent',
    });

    expect(observer.onMessage).toHaveBeenCalledWith(
      {
        type: 'subscribe',
        id: 'sub1',
        name: 'nonexistent',
      },
      'failed',
      'unknown-publication',
    );
  });

  it('notifies observer on applied subscribe request', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = { onMessage: vi.fn() };
    const pubs = new Publications(mongo, ws, observer);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(observer.onMessage).toHaveBeenCalledWith(
      {
        type: 'subscribe',
        id: 'sub1',
        name: 'files.all',
      },
      'applied',
      undefined,
    );
  });

  it('notifies observer when unsubscribe cannot find the sub id', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = { onMessage: vi.fn() };
    const pubs = new Publications(mongo, ws, observer);

    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    expect(observer.onMessage).toHaveBeenCalledWith(
      {
        type: 'unsubscribe',
        id: 'sub1',
      },
      'skipped',
      'unknown-sub-id',
    );
  });

  it('sends initial documents and ready signal on subscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(client.messages).toHaveLength(2);
    expect(client.messages).toEqual([
      {
        type: 'added',
        collection: 'files',
        id: '1',
        fields: { name: 'existing.bam' },
      },
      {
        type: 'ready',
        id: 'sub1',
      },
    ]);
  });

  it('sends ready even when no documents exist', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]).toEqual({ type: 'ready', id: 'sub1' });
  });

  it('pushes live changes to subscribed clients', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    const countAfterSubscribe = client.messages.length;
    expect(countAfterSubscribe).toBe(1);

    await mongo.insert('files', { name: 'new.bam' });

    const newMessages = client.messages.slice(countAfterSubscribe);
    expect(newMessages).toHaveLength(1);
    expect(newMessages).toContainEqual(
      expect.objectContaining({
        type: 'added',
        collection: 'files',
      }),
    );
  });

  it('stops sending updates after unsubscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    const countAfterUnsub = client.messages.length;

    await mongo.insert('files', { name: 'should-not-appear.bam' });

    const newMessages = client.messages.slice(countAfterUnsub);
    expect(newMessages).toHaveLength(0);
  });

  it('does not leak watchers on repeated subscribe/unsubscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[], [], []],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    for (let i = 0; i < 3; i++) {
      await pubs.handleMessage(client.id, {
        type: 'subscribe',
        id: `sub${String(i)}`,
        name: 'files.all',
      });
      await pubs.handleMessage(client.id, {
        type: 'unsubscribe',
        id: `sub${String(i)}`,
      });
    }

    const countAfterAll = client.messages.length;

    await mongo.insert('files', { name: 'leaked.bam' });

    const newMessages = client.messages.slice(countAfterAll);
    expect(newMessages).toHaveLength(0);
    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('tears down watchers when a client disconnects without unsubscribing', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(mongo.watcherCount('files')).toBe(1);

    client.close();

    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('tears down only the disconnecting client and leaves others intact', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[], []],
    });
    const ws = WebSocketWrapper.createNull();
    const clientA = ws.simulateConnection();
    const clientB = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(clientA.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });
    await pubs.handleMessage(clientB.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(mongo.watcherCount('files')).toBe(2);

    clientA.close();

    expect(mongo.watcherCount('files')).toBe(1);

    const countAfterClose = clientB.messages.length;
    await mongo.insert('files', { name: 'still-flowing.bam' });
    const newForB = clientB.messages.slice(countAfterClose);
    expect(newForB).toHaveLength(1);
  });

  it('keys subscriptions per client so two clients can pick the same sub id', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[], []],
    });
    const ws = WebSocketWrapper.createNull();
    const clientA = ws.simulateConnection();
    const clientB = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(clientA.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });
    await pubs.handleMessage(clientB.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    await pubs.handleMessage(clientA.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    expect(mongo.watcherCount('files')).toBe(1);

    const countAfterUnsub = clientB.messages.length;
    await mongo.insert('files', { name: 'for-b.bam' });
    const newForB = clientB.messages.slice(countAfterUnsub);
    expect(newForB).toHaveLength(1);
  });
});
