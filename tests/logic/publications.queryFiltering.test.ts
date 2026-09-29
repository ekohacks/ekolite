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

// `held` is what the initial find returns, so what the client holds from the start.
const subscribeToTasksOwnedBy = async (owner: string, held: Record<string, unknown>[] = []) => {
  const mongo = MongoWrapper.createNull({ find: [held] });
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

  it('sends removed when an update moves a held document out of the query', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada', [
      { _id: 'task-a', owner: 'ada', title: 'for ada' },
    ]);

    await mongo.update('tasks', { _id: 'task-a' }, { $set: { owner: 'bob' } });

    const [removed] = messagesOfType(client.messages, 'removed');
    expect(removed.id).toBe('task-a');
    expect(messagesOfType(client.messages, 'changed')).toHaveLength(0);
  });

  it('forgets a document that left: nothing more is said when it is later deleted', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada', [
      { _id: 'task-a', owner: 'ada' },
    ]);

    await mongo.update('tasks', { _id: 'task-a' }, { $set: { owner: 'bob' } });
    await mongo.update('tasks', { _id: 'task-a' }, { $set: { title: 'still bob' } });
    await mongo.remove('tasks', { _id: 'task-a' });

    expect(messagesOfType(client.messages, 'removed')).toHaveLength(1);
    expect(messagesOfType(client.messages, 'changed')).toHaveLength(0);
  });

  it('sends added when an update moves a document the client lacks into the query', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada');

    await mongo.update('tasks', { _id: 'task-b' }, { $set: { owner: 'ada', title: 'now ada' } });

    const [added] = messagesOfType(client.messages, 'added');
    expect(added.id).toBe('task-b');
    expect(added.fields).toEqual({ owner: 'ada', title: 'now ada' });
    expect(messagesOfType(client.messages, 'changed')).toHaveLength(0);
  });

  it('sends the next update to a document that came in as changed, and its delete', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada');

    await mongo.update('tasks', { _id: 'task-b' }, { $set: { owner: 'ada' } });
    await mongo.update('tasks', { _id: 'task-b' }, { $set: { title: 'renamed' } });
    await mongo.remove('tasks', { _id: 'task-b' });

    expect(messagesOfType(client.messages, 'added')).toHaveLength(1);
    const [changed] = messagesOfType(client.messages, 'changed');
    expect(changed.id).toBe('task-b');
    expect(changed.fields).toEqual({ title: 'renamed' });
    expect(messagesOfType(client.messages, 'removed')).toHaveLength(1);
  });

  it('keeps a held document when an update does not touch what the query reads', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada', [
      { _id: 'task-a', owner: 'ada', title: 'old' },
    ]);

    await mongo.update('tasks', { _id: 'task-a' }, { $set: { title: 'new' } });

    const [changed] = messagesOfType(client.messages, 'changed');
    expect(changed.id).toBe('task-a');
    expect(messagesOfType(client.messages, 'removed')).toHaveLength(0);
  });

  it('says nothing about an update outside the query on a document the client lacks', async () => {
    const { mongo, client } = await subscribeToTasksOwnedBy('ada');
    const before = client.messages.length;

    await mongo.update('tasks', { _id: 'task-b' }, { $set: { owner: 'bob' } });
    await mongo.update('tasks', { _id: 'task-b' }, { $set: { title: 'says nothing of owner' } });

    expect(client.messages.slice(before)).toEqual([]);
  });

  it('follows a query written with $in', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);
    pubs.define('tasks.team', () => ({
      collection: 'tasks',
      query: { owner: { $in: ['ada', 'grace'] } },
    }));
    await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'tasks.team' });

    await mongo.insert('tasks', { _id: 'task-g', owner: 'grace' });
    await mongo.insert('tasks', { _id: 'task-b', owner: 'bob' });

    expect(messagesOfType(client.messages, 'added').map((m) => m.id)).toEqual(['task-g']);
  });

  // The matcher is not Mongo. A query it cannot follow would either leak, if every
  // change were forwarded, or go quietly stale, if none were. Neither is acceptable, so
  // the subscription is refused where the developer will see it: at subscribe.
  it('refuses a subscription whose query live updates cannot follow', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const seen: unknown[] = [];
    const pubs = new Publications(mongo, ws, {
      onMessage: (_msg, outcome, reason) => seen.push([outcome, reason]),
    });
    pubs.define('tasks.like', () => ({ collection: 'tasks', query: { title: { $regex: '^a' } } }));

    await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'tasks.like' });

    const [error] = messagesOfType(client.messages, 'error') as unknown as {
      id: string;
      error: { code: number; message: string };
    }[];
    expect(error.id).toBe('sub1');
    expect(error.error.code).toBe(400);
    expect(error.error.message).toContain('$regex');
    expect(messagesOfType(client.messages, 'ready')).toHaveLength(0);
    expect(mongo.watcherCount('tasks')).toBe(0);
    expect(seen).toEqual([['failed', 'publication-query-unsupported']]);
  });
});
