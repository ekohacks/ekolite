import { createServer } from './index.ts';
import { MongoWrapper } from './infrastructure/mongo.ts';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { FileStorageWrapper } from './infrastructure/fileStorage.ts';
import { Publications } from './logic/publications.ts';
import { Files } from './logic/files.ts';

// Real boot. The same pieces the end-to-end test wires by hand, wired here for a
// live process: a Mongo connection, a websocket server, the pub/sub engine that
// turns subscriptions into live document streams, and the file store behind uploads.
const mongoUri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite';
const fileDir = process.env.FILE_DIR ?? './uploads';
const port = Number(process.env.PORT ?? 3001);

const mongo = MongoWrapper.create(mongoUri);
const ws = WebSocketWrapper.create();
const storage = FileStorageWrapper.create(fileDir);
const publications = new Publications(mongo, ws);
const files = new Files(mongo, storage);

// One publication to start with: every document in the files collection, kept in
// sync with the client as Mongo changes.
publications.define('files.all', () => ({ collection: 'files', query: {} }));

// Dev convenience: seed a couple of files so a fresh Mongo is not a blank page.
// Idempotent (only seeds an empty collection) and best-effort (a missing Mongo
// should not stop the server booting; subscriptions just come back empty).
try {
  const existing = await mongo.find('files', {});
  if (existing.length === 0) {
    await mongo.insert('files', { _id: 'seed-1', name: 'welcome.txt' });
    await mongo.insert('files', { _id: 'seed-2', name: 'getting-started.md' });
    console.warn('seeded files with 2 documents');
  }
} catch (err) {
  console.warn('skipped seeding (is Mongo running?):', err instanceof Error ? err.message : err);
}

const server = await createServer({ ws, publications, files });
await server.listen({ port, host: '0.0.0.0' });

console.warn(`EkoLite listening on http://localhost:${String(port)} (ws at /ws)`);
