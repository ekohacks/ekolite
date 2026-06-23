import { describe, it, expect } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { Publications } from '../../server/logic/publications.ts';

// Live change forwarding from the publications watcher to subscribers.
// 3.C.5 added 'changed' and 'removed' alongside 'added'. 3.C.6 (further down)
// gates 'removed' so a client is only told about deletes of docs it holds.

const messagesOfType = (messages: unknown[], type: string) =>
  messages.filter(
    (m): m is { type: string; collection: string; id: string; fields?: Record<string, unknown> } =>
      typeof m === 'object' && m !== null && (m as { type?: unknown }).type === type,
  );

const subscribeToFiles = async () => {
  const mongo = MongoWrapper.createNull({ find: [[]] });
  const ws = WebSocketWrapper.createNull();
  const client = ws.simulateConnection();
  const pubs = new Publications(mongo, ws);

  pubs.define('files.all', () => ({ collection: 'files', query: {} }));
  await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'files.all' });

  return { mongo, client, pubs };
};

describe('Publications live updates and deletes', () => {
  it('forwards a watched update to the client as a changed message', async () => {
    const { mongo, client } = await subscribeToFiles();

    await mongo.update('files', { name: 'old' }, { $set: { name: 'new' } });

    const [changed] = messagesOfType(client.messages, 'changed');
    expect(changed.collection).toBe('files');
    expect(changed.id).toBeTruthy();
    expect(changed.fields).toEqual({ name: 'new' });
  });

  it('forwards a watched delete to the client as a removed message', async () => {
    const { mongo, client } = await subscribeToFiles();

    await mongo.insert('files', { _id: 'doc-1', name: 'gone' });
    await mongo.remove('files', { _id: 'doc-1' });

    const [removed] = messagesOfType(client.messages, 'removed');
    expect(removed.collection).toBe('files');
    expect(removed.id).toBe('doc-1');
  });

  it('delivers a watched update as exactly one changed message, never as an added', async () => {
    const { mongo, client } = await subscribeToFiles();
    const before = client.messages.length;

    await mongo.update('files', {}, { $set: { name: 'renamed' } });

    const delivered = client.messages.slice(before);
    expect(delivered).toHaveLength(1);
    expect((delivered[0] as { type?: string }).type).toBe('changed');
  });

  // 3.C.6 part two: the watcher should forward a 'removed' only for a doc the
  // client holds. Today every delete is forwarded, so a delete of a doc the
  // client never received wrongly reaches it. This is the one genuine red.
  it('does not send a removed for a delete of a doc the client never held', async () => {
    const { mongo, client } = await subscribeToFiles();

    await mongo.remove('files', { _id: 'never-held' });

    expect(messagesOfType(client.messages, 'removed')).toHaveLength(0);
  });

  // Regression guard, green today: 3.C.5's documentIds.delete already prevents a
  // double removed. This pins that the gate keeps it that way.
  it('sends one removed for a held doc and none again on unsubscribe', async () => {
    const { mongo, client, pubs } = await subscribeToFiles();

    await mongo.insert('files', { _id: 'doc-1', name: 'live.bam' });
    await mongo.remove('files', { _id: 'doc-1' });

    expect(messagesOfType(client.messages, 'removed')).toHaveLength(1);

    const before = client.messages.length;
    await pubs.handleMessage(client.id, { type: 'unsubscribe', id: 'sub1' });

    expect(messagesOfType(client.messages.slice(before), 'removed')).toHaveLength(0);
  });
});
