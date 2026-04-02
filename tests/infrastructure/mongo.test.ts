import { describe, it, expect } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';

describe('MongoWrapper (null)', () => {
  it('inserts and finds documents', async () => {
    const mongo = MongoWrapper.createNull();
    await mongo.insert('testDocs', { name: 'test.bam' });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('test.bam');
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
    const mongo = MongoWrapper.createNull();
    await mongo.insert('testDocs', { name: 'old' });
    await mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('new');
  });

  it('removes matching documents', async () => {
    const mongo = MongoWrapper.createNull();
    await mongo.insert('testDocs', { name: 'keep' });
    await mongo.insert('testDocs', { name: 'remove' });
    await mongo.remove('testDocs', { name: 'remove' });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('keep');
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
});

describe('MongoWrapper (null) with configurable responses', () => {
  it('returns configured find responses in order', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', title: 'First call' }], []],
    });
    const first = await mongo.find('tasks', {});
    expect(first).toEqual([{ _id: '1', title: 'First call' }]);
    const second = await mongo.find('tasks', {});
    expect(second).toEqual([]);
  });

  it('throws configured error responses', async () => {
    const mongo = MongoWrapper.createNull({
      find: [new Error('Connection lost')],
    });
    await expect(mongo.find('tasks', {})).rejects.toThrow('Connection lost');
  });

  it('falls back to in-memory store when no configurable responses provided', async () => {
    const mongo = MongoWrapper.createNull();
    await mongo.insert('tasks', { name: 'seeded' });
    const docs = await mongo.find<{ name: string }>('tasks', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('seeded');
  });
});
