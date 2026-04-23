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

    expect(client.messages).toContainEqual({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });
    expect(client.messages).toContainEqual({
      type: 'ready',
      id: 'sub1',
    });
  });
});
