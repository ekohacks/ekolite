import { describe, it, expect } from 'vitest';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { Publications } from '../../server/logic/publications.ts';
import { Files } from '../../server/logic/files.ts';

// 5.B.2: an upload surfaces live. Files.upload inserts a document, the publications
// watcher maps that insert to an `added`, and a files.all subscriber sees it without
// asking again. Every wire already exists; this pins the path end to end.
//
// Files and Publications share one Mongo, the way start.ts wires them, so the insert
// from upload reaches the watcher the subscription opened.

const messagesOfType = (messages: unknown[], type: string) =>
  messages.filter(
    (m): m is { type: string; collection: string; id: string; fields?: Record<string, unknown> } =>
      typeof m === 'object' && m !== null && (m as { type?: unknown }).type === type,
  );

describe('Upload triggers a real-time list update', () => {
  it('forwards a freshly uploaded file to a files.all subscriber as an added', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const storage = FileStorageWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();

    const pubs = new Publications(mongo, ws);
    const files = new Files(mongo, storage);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    // Subscribe first: a watch only sees inserts that happen after it opens.
    await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'files.all' });

    await files.upload({
      name: 'sample.bam',
      type: 'application/octet-stream',
      data: Buffer.from('BAMDATA'),
    });

    const [added] = messagesOfType(client.messages, 'added');
    expect(added).toBeDefined();
    expect(added.collection).toBe('files');
    expect(added.fields?.name).toBe('sample.bam');
  });
});
