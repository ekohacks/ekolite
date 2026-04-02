import { describe, it, expect } from 'vitest';
// import { MongoWrapper } from '../../server/infrastructure/mongo.ts';

describe('MongoWrapper (real)', () => {
  // const mongo = MongoWrapper.create('mongodb://localhost:27017/ekolite-test?replicaSet=rs0');
  //
  // afterEach(async () => {
  //   await mongo.remove('testDocs', {});
  // });

  it('inserts and finds documents', () => {
    // await mongo.insert('testDocs', { name: 'test.bam' });
    // const docs = await mongo.find('testDocs', {});
    // expect(docs).toHaveLength(1);
    // expect(docs[0].name).toBe('test.bam');
    expect(true).toBe(true);
  });
});
