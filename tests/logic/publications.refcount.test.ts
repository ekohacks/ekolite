import { expect, it } from 'vitest';
import { Publications } from '../../server/logic/publications.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

it.fails('unsubscribing one sub does not remove a doc the other still covers', async () => {
  const mongo = MongoWrapper.createNull({
    find: [[{ _id: '1', name: 'shared.bam' }], [{ _id: '1', name: 'shared.bam' }]],
  });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));
  pubs.define('files.featured', () => ({ collection: 'files', query: {} }));

  await pubs.handleMessage(client.id, { type: 'subscribe', id: 'subA', name: 'files.all' });
  await pubs.handleMessage(client.id, { type: 'subscribe', id: 'subB', name: 'files.featured' });

  const countBeforeUnsub = client.messages.length;
  await pubs.handleMessage(client.id, { type: 'unsubscribe', id: 'subA' });

  const removedForSharedDoc = client.messages
    .slice(countBeforeUnsub)
    .find((m) => (m as { type: string }).type === 'removed');

  expect(removedForSharedDoc).toBeUndefined();
});
