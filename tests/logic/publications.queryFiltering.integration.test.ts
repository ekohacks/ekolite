import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { Publications } from '../../server/logic/publications.ts';

// The unit tests drive the engine with the Nulled Mongo, whose updates carry only
// what was written. A real change stream hands over the whole document, which is the
// other path through the matcher: a field the document lacks is missing, not unknown.
// This pins that path against a real replica set, ids and all.

interface Sent {
  type: string;
  id: string;
  fields?: Record<string, unknown>;
}

const COLLECTION = 'filteredTasks';

describe('Publications query filtering (real Mongo)', () => {
  const mongo = MongoWrapper.create('mongodb://localhost:27017/ekolite-test?replicaSet=rs0');

  afterEach(async () => {
    await mongo.remove(COLLECTION, {});
  });

  afterAll(async () => {
    await mongo.close();
  });

  const subscribeAs = async (owner: string) => {
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);
    pubs.define('tasks.mine', (params) => ({
      collection: COLLECTION,
      query: { owner: params?.owner },
    }));
    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'tasks.mine',
      params: { owner },
    });

    const sent = () => (client.messages as Sent[]).filter((m) => m.type !== 'ready');
    const until = async (count: number) => {
      const deadline = Date.now() + 5000;
      while (sent().length < count && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return sent();
    };
    return { pubs, until, sent };
  };

  it('follows one document out of a query and into another', async () => {
    const ada = await subscribeAs('ada');
    const bob = await subscribeAs('bob');

    try {
      await mongo.insert(COLLECTION, { owner: 'ada', title: 'first' });
      const [added] = await ada.until(1);
      expect(added).toMatchObject({ type: 'added', fields: { owner: 'ada', title: 'first' } });

      await mongo.update(COLLECTION, { title: 'first' }, { $set: { title: 'renamed' } });
      expect((await ada.until(2))[1]).toMatchObject({
        type: 'changed',
        id: added.id,
        fields: { owner: 'ada', title: 'renamed' },
      });

      await mongo.update(COLLECTION, { title: 'renamed' }, { $set: { owner: 'bob' } });
      expect((await ada.until(3))[2]).toEqual({
        type: 'removed',
        collection: COLLECTION,
        id: added.id,
      });
      // Bob never held it, and the change carries the whole document, so it arrives whole.
      expect(await bob.until(1)).toEqual([
        {
          type: 'added',
          collection: COLLECTION,
          id: added.id,
          fields: { owner: 'bob', title: 'renamed' },
        },
      ]);

      // Everything Ada was sent, and nothing of Bob's afterwards.
      await mongo.update(COLLECTION, { title: 'renamed' }, { $set: { title: 'bob only' } });
      await bob.until(2);
      expect(ada.sent().map((m) => m.type)).toEqual(['added', 'changed', 'removed']);
    } finally {
      await ada.pubs.stopAll();
      await bob.pubs.stopAll();
    }
  });

  it('takes a document away when the field the query reads is unset', async () => {
    const ada = await subscribeAs('ada');

    try {
      await mongo.insert(COLLECTION, { owner: 'ada', title: 'first' });
      const [added] = await ada.until(1);

      await mongo.update(COLLECTION, { title: 'first' }, { $unset: { owner: '' } });

      expect((await ada.until(2))[1]).toEqual({
        type: 'removed',
        collection: COLLECTION,
        id: added.id,
      });
    } finally {
      await ada.pubs.stopAll();
    }
  });
});
