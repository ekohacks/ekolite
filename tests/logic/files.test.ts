import { describe, expect, it } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { Files } from '../../server/logic/files.ts';

// The files logic, in isolation, on nulled infrastructure. Upload writes the bytes
// to the store and records a document describing the file, so the same document can
// later stream to subscribers through publications.
describe('Files.upload', () => {
  it('saves the bytes and inserts a document describing the file', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);
    const inserts = mongo.trackChanges('files');

    const stored = await files.upload({
      name: 'a.bam',
      type: 'application/octet-stream',
      data: Buffer.from('xyz'),
    });

    expect(await storage.exists('a.bam')).toBe(true);
    expect(stored).toEqual(expect.objectContaining({ name: 'a.bam', size: 3, extension: 'bam' }));

    const insert = inserts.data.find((event) => (event as { type?: unknown }).type === 'insert');
    expect(insert).toBeDefined();
    expect((insert as { fields: { name?: unknown } }).fields.name).toBe('a.bam');
  });
});
