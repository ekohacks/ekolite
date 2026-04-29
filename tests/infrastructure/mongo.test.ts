import { describe, expect, it } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';

describe('MongoWrapper (null)', () => {
  it('returns configured find responses in order', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'test.bam' }], []],
    });
    const first = await mongo.find<{ name: string }>('testDocs', {});
    expect(first).toEqual([{ _id: '1', name: 'test.bam' }]);
    const second = await mongo.find('testDocs', {});
    expect(second).toEqual([]);
  });

  it('throws configured find error', async () => {
    const mongo = MongoWrapper.createNull({
      find: [new Error('Connection lost')],
    });
    await expect(mongo.find('testDocs', {})).rejects.toThrow('Connection lost');
  });

  it('returns empty array when find has no configured responses', async () => {
    const mongo = MongoWrapper.createNull();
    const docs = await mongo.find('testDocs', {});
    expect(docs).toEqual([]);
  });

  it('consumes configured insert responses', async () => {
    const mongo = MongoWrapper.createNull({
      insert: [undefined],
    });
    await expect(mongo.insert('testDocs', { name: 'test' })).resolves.toBeUndefined();
  });

  it('throws configured insert error', async () => {
    const mongo = MongoWrapper.createNull({
      insert: [new Error('Duplicate key')],
    });
    await expect(mongo.insert('testDocs', { name: 'test' })).rejects.toThrow('Duplicate key');
  });

  it('consumes configured update responses', async () => {
    const mongo = MongoWrapper.createNull({
      update: [undefined],
    });
    await expect(
      mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } }),
    ).resolves.toBeUndefined();
  });

  it('throws configured update error', async () => {
    const mongo = MongoWrapper.createNull({
      update: [new Error('Write conflict')],
    });
    await expect(
      mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } }),
    ).rejects.toThrow('Write conflict');
  });

  it('consumes configured remove responses', async () => {
    const mongo = MongoWrapper.createNull({
      remove: [undefined],
    });
    await expect(mongo.remove('testDocs', { name: 'gone' })).resolves.toBeUndefined();
  });

  it('throws configured remove error', async () => {
    const mongo = MongoWrapper.createNull({
      remove: [new Error('Not authorised')],
    });
    await expect(mongo.remove('testDocs', { name: 'gone' })).rejects.toThrow('Not authorised');
  });

  it('tracks insert change events', async () => {
    const mongo = MongoWrapper.createNull({
      insert: [undefined],
    });
    const tracker = mongo.trackChanges('testDocs');
    await mongo.insert('testDocs', { name: 'test' });
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toMatchObject({
      type: 'insert',
      collection: 'testDocs',
      fields: { name: 'test' },
    });
    expect(tracker.data[0]).toHaveProperty('id');
  });

  it('tracks update change events', async () => {
    const mongo = MongoWrapper.createNull({
      update: [undefined],
    });
    const tracker = mongo.trackChanges('testDocs');
    await mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } });
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toMatchObject({
      type: 'update',
      collection: 'testDocs',
      fields: { name: 'new' },
    });
    expect(tracker.data[0]).toHaveProperty('id');
  });

  it('tracks remove change events', async () => {
    const mongo = MongoWrapper.createNull({
      remove: [undefined],
    });
    const tracker = mongo.trackChanges('testDocs');
    await mongo.remove('testDocs', { name: 'gone' });
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toMatchObject({
      type: 'remove',
      collection: 'testDocs',
    });
    expect(tracker.data[0]).toHaveProperty('id');
  });

  it('tracks insert change events', async () => {
    const mongo = MongoWrapper.createNull();
    const tracker = mongo.trackChanges('testDocs');
    await mongo.insert('testDocs', { name: 'test' });
    expect(tracker.data).toHaveLength(1);
    expect(tracker.data[0]).toMatchObject({
      type: 'insert',
      collection: 'testDocs',
      fields: { name: 'test' },
    });
    expect(tracker.data[0]).toHaveProperty('id');
  });

  it('updates a document', async () => {
    const mongo = MongoWrapper.createNull({ find: [[{ name: 'new' }]] });
    const tracker = mongo.trackChanges('testDocs');
    await mongo.insert('testDocs', { name: 'old' });
    await mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('new');

    expect(tracker.data[0]).toMatchObject({
      type: 'insert',
      collection: 'testDocs',
      fields: { name: 'old' },
    });
    expect(tracker.data[1]).toMatchObject({
      type: 'update',
      collection: 'testDocs',
      fields: { name: 'new' },
    });
    expect(tracker.data[2]).toMatchObject({ type: 'find', collection: 'testDocs', query: {} });
  });

  it('removes matching documents', async () => {
    const mongo = MongoWrapper.createNull({ find: [[{ name: 'keep' }]] });
    const tracker = mongo.trackChanges('testDocs');
    await mongo.insert('testDocs', { name: 'keep' });
    await mongo.insert('testDocs', { name: 'remove' });
    await mongo.remove('testDocs', { name: 'remove' });
    const docs = await mongo.find<{ name: string }>('testDocs', {});

    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('keep');

    expect(tracker.data[0]).toMatchObject({
      type: 'insert',
      collection: 'testDocs',
      fields: { name: 'keep' },
    });
    expect(tracker.data[1]).toMatchObject({
      type: 'insert',
      collection: 'testDocs',
      fields: { name: 'remove' },
    });
    expect(tracker.data[2]).toMatchObject({ type: 'remove', collection: 'testDocs' });
    expect(tracker.data[3]).toMatchObject({ type: 'find', collection: 'testDocs', query: {} });
  });

  it('tracks update change events', async () => {
    const mongo = MongoWrapper.createNull();
    const tracker = mongo.trackChanges('testDocs');
    await mongo.insert('testDocs', { name: 'old' });
    await mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } });
    expect(tracker.data).toHaveLength(2);
    expect(tracker.data[1]).toMatchObject({
      type: 'update',
      collection: 'testDocs',
      fields: { name: 'new' },
    });
    expect(tracker.data[1]).toHaveProperty('id');
  });

  it('tracks remove change events', async () => {
    const mongo = MongoWrapper.createNull();
    const tracker = mongo.trackChanges('testDocs');
    await mongo.insert('testDocs', { name: 'gone' });
    await mongo.remove('testDocs', { name: 'gone' });
    expect(tracker.data).toHaveLength(2);
    expect(tracker.data[1]).toMatchObject({
      type: 'remove',
      collection: 'testDocs',
    });
    expect(tracker.data[1]).toHaveProperty('id');
  });

  it('reports zero watchers for an unwatched collection', () => {
    const mongo = MongoWrapper.createNull();
    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('counts active watchers from watchChanges', () => {
    const mongo = MongoWrapper.createNull();
    const stop1 = mongo.watchChanges('files', () => {});
    expect(mongo.watcherCount('files')).toBe(1);
    const stop2 = mongo.watchChanges('files', () => {});
    expect(mongo.watcherCount('files')).toBe(2);
    stop1();
    expect(mongo.watcherCount('files')).toBe(1);
    stop2();
    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('counts watchers per collection', () => {
    const mongo = MongoWrapper.createNull();
    mongo.watchChanges('files', () => {});
    mongo.watchChanges('scripts', () => {});
    mongo.watchChanges('scripts', () => {});
    expect(mongo.watcherCount('files')).toBe(1);
    expect(mongo.watcherCount('scripts')).toBe(2);
    expect(mongo.watcherCount('other')).toBe(0);
  });
});
