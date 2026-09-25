import { describe, it, expect } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { Publications } from '../../server/logic/publications.ts';

// A publication's query filters the initial find. It must also filter the live
// changes that follow, per subscription, or a client subscribed to one owner's
// tasks is sent every other owner's tasks as they arrive.

const messagesOfType = (messages: unknown[], type: string) =>
  messages.filter(
    (m): m is { type: string; collection: string; id: string; fields?: Record<string, unknown> } =>
      typeof m === 'object' && m !== null && (m as { type?: unknown }).type === type,
  );

const subscribeToTasksOwnedBy = async (owner: string) => {
  const mongo = MongoWrapper.createNull({ find: [[]] });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('tasks.mine', (params) => ({
    collection: 'tasks',
    query: { owner: params?.owner },
  }));
  await pubs.handleMessage(client.id, {
    type: 'subscribe',
    id: 'sub1',
    name: 'tasks.mine',
    params: { owner },
  });

  return { mongo, client, pubs };
};

describe('Publications live changes respect the query', () => {
  it('does not send an added for an insert outside the subscription query', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada');

    await mongo.insert('tasks', { _id: 'task-b', owner: 'bob', title: 'not for ada' });

    expect(messagesOfType(client.messages, 'added')).toHaveLength(0);
  });

  // Green today. Pins that the filter drops only what falls outside the query,
  // so the red above cannot go green by dropping every insert.
  it('still sends an added for an insert inside the subscription query', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada');

    await mongo.insert('tasks', { _id: 'task-a', owner: 'ada', title: 'for ada' });

    const [added] = messagesOfType(client.messages, 'added');
    expect(added.id).toBe('task-a');
    expect(added.fields).toEqual({ owner: 'ada', title: 'for ada' });
  });
});
