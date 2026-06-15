import { describe, it, expect } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { Publications } from '../../server/logic/publications.ts';

// RED: the live watcher in publications.ts only forwards 'insert' changes today
// (see the change.type === 'insert' branch). 'update' and 'remove' changes are
// dropped, so a subscribed client never hears about edits or deletions. These
// pin the wire messages the watcher should send for each change type.

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

  return { mongo, client };
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

    await mongo.remove('files', { name: 'gone' });

    const [removed] = messagesOfType(client.messages, 'removed');
    expect(removed.collection).toBe('files');
    expect(removed.id).toBeTruthy();
  });

  it('delivers a watched update as exactly one changed message, never as an added', async () => {
    const { mongo, client } = await subscribeToFiles();
    const before = client.messages.length;

    await mongo.update('files', {}, { $set: { name: 'renamed' } });

    const delivered = client.messages.slice(before);
    expect(delivered).toHaveLength(1);
    expect((delivered[0] as { type?: string }).type).toBe('changed');
  });
});
