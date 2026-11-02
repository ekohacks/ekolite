import { describe, expect, it } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { ChangeEvent } from '../../shared/types.ts';
import { mongoContract } from './mongoContract.ts';

describe('MongoWrapper (null)', () => {
  // Same behaviour the real driver is held to in the integration suite.
  mongoContract(() => MongoWrapper.createNull());

  // What only a null can do: answer a find from configuration, and fail on command.
  it('returns configured find responses in order, ahead of what it holds', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'test.bam' }], []],
    });
    await mongo.insert('testDocs', { name: 'held' });

    expect(await mongo.find<{ name: string }>('testDocs', {})).toEqual([
      { _id: '1', name: 'test.bam' },
    ]);
    expect(await mongo.find('testDocs', {})).toEqual([]);
  });

  it('throws configured find, insert, update and remove errors', async () => {
    const mongo = MongoWrapper.createNull({
      find: [new Error('Connection lost')],
      insert: [new Error('Duplicate key')],
      update: [new Error('Write conflict')],
      remove: [new Error('Not authorised')],
    });

    await expect(mongo.find('testDocs', {})).rejects.toThrow('Connection lost');
    await expect(mongo.insert('testDocs', { name: 'test' })).rejects.toThrow('Duplicate key');
    await expect(
      mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } }),
    ).rejects.toThrow('Write conflict');
    await expect(mongo.remove('testDocs', { name: 'gone' })).rejects.toThrow('Not authorised');
  });

  it('throws a configured insert error without holding the document', async () => {
    const mongo = MongoWrapper.createNull({ insert: [new Error('Duplicate key')] });

    await expect(mongo.insert('testDocs', { name: 'test' })).rejects.toThrow('Duplicate key');
    expect(await mongo.find('testDocs', {})).toEqual([]);
  });

  it('tracks changes on a collection without a watcher being registered', async () => {
    const mongo = MongoWrapper.createNull();
    const tracker = await mongo.trackChanges('testDocs');

    await mongo.insert('testDocs', { _id: 'doc-1', name: 'test' });
    await mongo.update('testDocs', { _id: 'doc-1' }, { $set: { name: 'new' } });
    await mongo.remove('testDocs', { _id: 'doc-1' });

    expect(tracker.data).toEqual([
      { type: 'insert', collection: 'testDocs', id: 'doc-1', fields: { name: 'test' } },
      { type: 'update', collection: 'testDocs', id: 'doc-1', fields: { name: 'new' } },
      { type: 'remove', collection: 'testDocs', id: 'doc-1' },
    ]);
  });

  it('mints an id for a document inserted without one', async () => {
    const mongo = MongoWrapper.createNull();
    const tracker = await mongo.trackChanges('testDocs');

    await mongo.insert('testDocs', { name: 'test' });

    const inserted = tracker.data[0] as ChangeEvent;
    expect(inserted.type).toBe('insert');
    expect(inserted.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('close() stops the underlying change streams so no changes arrive after', async () => {
    const mongo = MongoWrapper.createNull();
    const changes: ChangeEvent[] = [];
    await mongo.watchChanges('todos', (c) => changes.push(c));

    await mongo.close();
    await mongo.insert('todos', { text: 'after close' });

    // With the streams stopped, the insert reaches no watcher. Before the fix,
    // close() left the change stream open and this insert still arrived — the same
    // open-stream-while-client-closes race that logs MongoClientClosedError in prod.
    expect(changes).toHaveLength(0);
  });

  it('consumes a configured close response, so a failing close can be rehearsed', async () => {
    const mongo = MongoWrapper.createNull({ close: [new Error('Topology is closed')] });

    await expect(mongo.close()).rejects.toThrow('Topology is closed');
  });
});
