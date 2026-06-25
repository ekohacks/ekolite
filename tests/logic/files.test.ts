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
    const inserts = await mongo.trackChanges('files');

    const stored = await files.upload({
      name: 'a.bam',
      type: 'application/octet-stream',
      data: Buffer.from('xyz'),
    });

    expect(await storage.exists('a.bam')).toBe(true);
    expect(stored).toEqual(expect.objectContaining({ name: 'a.bam', size: 3, extension: 'bam' }));
    expect(stored.path).toBe(storage.resolve('a.bam'));

    const insert = inserts.data.find((event) => (event as { type?: unknown }).type === 'insert');
    expect(insert).toBeDefined();
    expect((insert as { fields: { name?: unknown } }).fields.name).toBe('a.bam');
  });
});

// Read looks the document up by id, then hands back the stored bytes for it. The
// document is the source of truth for the id to file name mapping.
describe('Files.read', () => {
  it('reads back the bytes and the document for a stored file', async () => {
    const mongo = MongoWrapper.createNull({
      find: [
        [
          {
            _id: 'known',
            name: 'a.txt',
            path: '/x/a.txt',
            size: 5,
            extension: 'txt',
            uploadedAt: new Date(),
          },
        ],
      ],
    });
    const storage = FileStorageWrapper.createNull();
    await storage.save('a.txt', Buffer.from('hello'));
    const files = new Files(mongo, storage);

    const result = await files.read('known');

    expect(result?.file.name).toBe('a.txt');
    expect(result?.data).toEqual(Buffer.from('hello'));
  });

  it('returns null when the file id is unknown', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);

    expect(await files.read('nope')).toBeNull();
  });

  it('validates files by the extension', () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();

    const files = new Files(mongo, storage);

    expect(files.validate('sample.bam')).toBe(true);
    expect(files.validate('notes.txt')).toBe(false);
  });

  it('accepts a configured extension such as .cram', () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();

    const wide = new Files(mongo, storage, {
      allowedExtensions: ['bam', 'cram'],
    });
    expect(wide.validate('reads.cram')).toBe(true);
  });

  it('rejects an unsupported upload before writing anything', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);
    const inserts = await mongo.trackChanges('files');

    await expect(
      files.upload({ name: 'bad.txt', type: 'text/plain', data: Buffer.from('x') }),
    ).rejects.toMatchObject({ code: 400 });

    expect(await storage.exists('bad.txt')).toBe(false);
    expect(inserts.data).toHaveLength(0);
  });
});
