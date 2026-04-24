import { describe, it, expect } from 'vitest';
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
});
