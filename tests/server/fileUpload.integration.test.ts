import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { Files } from '../../server/logic/files.ts';

// End to end over real HTTP: a multipart upload lands bytes on the file store and a
// document in the files collection (which is what makes it show up in the live list).
// Storage and Mongo are nulled because this is about the HTTP wiring, not the disk.
//
// Red until: @fastify/multipart is registered, createServer accepts files, and a
// POST /api/files route runs files.upload.

describe('file upload over real HTTP', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  afterEach(async () => {
    await server.close();
  });

  it('stores the bytes and inserts a files document', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const files = new Files(mongo, storage);
    const inserts = await mongo.trackChanges('files');

    server = await createServer({ ws, files });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from('hello there')], { type: 'text/plain' }),
      'greeting.bam',
    );
    const res = await fetch(`http://localhost:${port}/api/files`, { method: 'POST', body: form });

    expect(res.status).toBe(201);
    expect(await storage.exists('greeting.bam')).toBe(true);

    const insert = inserts.data.find((event) => (event as { type?: unknown }).type === 'insert');
    expect(insert).toBeDefined();
    expect((insert as { fields: { name?: unknown } }).fields.name).toBe('greeting.bam');
  });

  it('returns an ekoLiteError shaped with a code of 400', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const files = new Files(mongo, storage);
    const inserts = await mongo.trackChanges('files');

    server = await createServer({ ws, files });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from('hello there')], { type: 'text/plain' }),
      'greeting.txt',
    );

    const res = await fetch(`http://localhost:${port}/api/files`, { method: 'POST', body: form });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 400 });

    const insert = inserts.data.find((event) => (event as { type?: unknown }).type === 'insert');
    expect(insert).toBeUndefined();
  });

  // Step c of the story: every route renders an EkoLiteError the same way. These two
  // replies are still the old { error } shape. Marked `it.fails` so the pipeline stays
  // green while they document the gap. Flip `it.fails` back to `it` locally to watch
  // them fail, fold the replies into { code, message }, then they pass as normal tests
  // (at which point `it.fails` goes red, telling you to drop the `.fails`).
  it('answers a missing file in the shared EkoLiteError shape', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const files = new Files(mongo, storage);

    server = await createServer({ ws, files });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    // A multipart body with fields but no file part hits the "no file" branch.
    const form = new FormData();
    form.append('note', 'no file here');

    const res = await fetch(`http://localhost:${port}/api/files`, { method: 'POST', body: form });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 400 });
  });

  it('answers an unknown file id in the shared EkoLiteError shape', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const files = new Files(mongo, storage);

    server = await createServer({ ws, files });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const res = await fetch(`http://localhost:${port}/api/files/does-not-exist`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 404 });
  });
});
