import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../server/index.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { Files } from '../../server/logic/files.ts';

// End to end over real HTTP: GET /api/files/:id looks the document up, reads the
// bytes off the store, and streams them back. Storage and Mongo are nulled and
// seeded here because this is about the route, not the disk.
//
// Red until Files.read and FileStorageWrapper.read exist and createServer serves
// the GET /api/files/:id route.

describe('file download over real HTTP', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  afterEach(async () => {
    await server.close();
  });

  it('serves the stored bytes for a known file id', async () => {
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
    await storage.save('a.txt', Buffer.from('hello over http'));
    const ws = WebSocketWrapper.createNull();
    const files = new Files(mongo, storage);

    server = await createServer({ ws, files });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const res = await fetch(`http://localhost:${port}/api/files/known`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello over http');
  });

  it('returns 404 for an unknown file id', async () => {
    const mongo = MongoWrapper.createNull();
    const storage = FileStorageWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const files = new Files(mongo, storage);

    server = await createServer({ ws, files });
    await server.listen({ port: 0 });
    const port = String(server.addresses()[0].port);

    const res = await fetch(`http://localhost:${port}/api/files/missing`);

    expect(res.status).toBe(404);
  });
});
