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

  it.skip('updates a document', async () => {
    const mongo = MongoWrapper.createNull();
    await mongo.insert('testDocs', { name: 'old' });
    await mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('new');
  });

  it.skip('removes matching documents', async () => {
    const mongo = MongoWrapper.createNull();
    await mongo.insert('testDocs', { name: 'keep' });
    await mongo.insert('testDocs', { name: 'remove' });
    await mongo.remove('testDocs', { name: 'remove' });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('keep');
  });

  it.skip('tracks update change events', async () => {
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

  it.skip('tracks remove change events', async () => {
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
