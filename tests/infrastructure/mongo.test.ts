// import { describe, it, expect } from 'vitest';
// import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
//
// describe('MongoWrapper (null)', () => {
//   it('inserts and finds documents', async () => {
//     const mongo = MongoWrapper.createNull();
//     await mongo.insert('testDocs', { name: 'test.bam' });
//     const docs = await mongo.find('testDocs', {});
//     expect(docs).toHaveLength(1);
//     expect(docs[0].name).toBe('test.bam');
//   });
// });
