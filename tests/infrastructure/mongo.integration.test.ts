import { describe, it, expect, afterEach } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';

describe('MongoWrapper (real)', () => {
  const mongo = MongoWrapper.create('mongodb://localhost:27017/ekolite-test?replicaSet=rs0');

  afterEach(async () => {
    await mongo.remove('testDocs', {});
  });

  it('inserts and finds documents', async () => {
    await mongo.insert('testDocs', { name: 'test.bam' });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('test.bam');
  });

  it('updates a document', async () => {
    await mongo.insert('testDocs', { name: 'old' });
    await mongo.update('testDocs', { name: 'old' }, { $set: { name: 'new' } });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('new');
  });

  it('removes matching documents', async () => {
    await mongo.insert('testDocs', { name: 'keep' });
    await mongo.insert('testDocs', { name: 'remove' });
    await mongo.remove('testDocs', { name: 'remove' });
    const docs = await mongo.find<{ name: string }>('testDocs', {});
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('keep');
  });

  it('emits change stream events for insert, update, and delete', async () => {
    const changes: unknown[] = [];
    const stop = await mongo.watchChanges('testDocs', (change) => {
      changes.push(change);
    });

    try {
      await mongo.insert('testDocs', { name: 'hello' });
      await mongo.update('testDocs', { name: 'hello' }, { $set: { name: 'updated' } });
      await mongo.remove('testDocs', { name: 'updated' });

      const deadline = Date.now() + 5000;
      while (changes.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(changes).toHaveLength(3);
      expect(changes[0]).toMatchObject({ type: 'insert', collection: 'testDocs' });
      expect(changes[1]).toMatchObject({ type: 'update', collection: 'testDocs' });
      expect(changes[2]).toMatchObject({ type: 'remove', collection: 'testDocs' });
    } finally {
      stop();
    }
  });
});
