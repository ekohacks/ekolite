import { describe, it, expect } from 'vitest';
import { Publications } from '../../server/logic/publications.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

// Characterisation test (passes today). It documents the premise the client
// gate leans on but the server never promised: the collection a publication
// emits is whatever its query function returns, decided independently of the
// publication name. Here a publication named 'recentFiles' emits into 'files'.
// The client's name.split('.')[0] would read 'recentFiles' and miss every doc.
describe('Publications: name and collection are independent', () => {
  it('emits the collection returned by the query function, not the publication name', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('recentFiles', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'recentFiles',
    });

    expect(client.messages).toContainEqual({
      type: 'added',
      collection: 'files',
      id: '1',
      fields: { name: 'existing.bam' },
    });
  });
});
