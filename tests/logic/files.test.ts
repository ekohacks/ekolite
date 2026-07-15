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

    expect(await files.read('nope')).toBeUndefined();
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

// A count computed on the server is written back onto the file's own document, so it
// streams to subscribers through the same files.all publication the upload used. The
// write is a $set on the existing file keyed by id, not a new document.
describe('Files.recordCountC', () => {
  it('writes the count onto the file document as a $set keyed by id', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);
    const updates = await mongo.trackChanges('files');

    await files.recordCountC('file-1', 42);

    const update = updates.data.find((event) => (event as { type?: unknown }).type === 'update');
    expect(update).toMatchObject({ type: 'update', collection: 'files', id: 'file-1' });
    // Exactly the count and nothing else, so $set merges the field rather than
    // replacing the document and losing name, path and the rest.
    expect((update as { fields: unknown }).fields).toEqual({ countC: 42 });
  });

  it('writes a count of zero rather than dropping it', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);
    const updates = await mongo.trackChanges('files');

    await files.recordCountC('file-1', 0);

    const update = updates.data.find((event) => (event as { type?: unknown }).type === 'update');
    expect((update as { fields: unknown }).fields).toEqual({ countC: 0 });
  });

  it('updates the existing document rather than inserting a new one', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);
    const changes = await mongo.trackChanges('files');

    await files.recordCountC('file-1', 7);

    const byType = (type: string) =>
      changes.data.filter((event) => (event as { type?: unknown }).type === type);
    expect(byType('insert')).toHaveLength(0);
    expect(byType('update')).toHaveLength(1);
  });
});

// locate is the lean lookup runCountC needs: the document for an id, and only the
// document. Unlike read it does not pull the bytes off disk, because the analysis
// script opens the file itself and only the path is needed.
describe('Files.locate', () => {
  it('returns the document for a known id without reading the bytes', async () => {
    const mongo = MongoWrapper.createNull({
      find: [
        [
          {
            _id: 'known',
            name: 'reads.bam',
            path: '/data/reads.bam',
            size: 9,
            extension: 'bam',
            uploadedAt: new Date(),
          },
        ],
      ],
    });
    // Storage is empty on purpose: if locate read the bytes it would fail here,
    // so a document coming back proves it never touched the store.
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);

    const file = await files.locate('known');

    expect(file).toMatchObject({ _id: 'known', name: 'reads.bam', path: '/data/reads.bam' });
  });

  it('returns undefined when the id is unknown', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const files = new Files(mongo, storage);

    expect(await files.locate('nope')).toBeUndefined();
  });
});
