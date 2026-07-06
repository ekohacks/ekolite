import { describe, it, expect } from 'vitest';
import { Publications } from '../../server/logic/publications.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import {
  ObserverOutcome,
  PublicationsObserver,
  PublicationsReasons,
} from '../../shared/protocol.ts';

describe('Publications', () => {
  it('sends error when subscribing to unknown publication', async () => {
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'nonexistent',
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'sub1',
      error: { code: 404, message: 'Unknown publication: nonexistent' },
    });
  });

  it('stopAll stops every active subscription watch across clients', async () => {
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const clientA = ws.simulateConnection();
    const clientB = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);
    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(clientA.id, { type: 'subscribe', id: 's1', name: 'files.all' });
    await pubs.handleMessage(clientB.id, { type: 'subscribe', id: 's2', name: 'files.all' });
    expect(mongo.watcherCount('files')).toBe(2);

    await pubs.stopAll();

    // Every client's change stream is drained, so a shutdown can close Mongo with
    // no stream still open underneath it.
    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('notifies observer on failed subscribe for unknown publication', async () => {
    const notifications: { type: string; outcome: ObserverOutcome; reason?: string | undefined }[] =
      [];
    const mongo = MongoWrapper.createNull();
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer: PublicationsObserver = {
      onMessage(msg, outcome, reason) {
        notifications.push({ type: msg.type, outcome, reason });
      },
    };

    const pubs = new Publications(mongo, ws, observer);

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'nonexistent',
    });

    expect(notifications).toHaveLength(1);
    expect(notifications).toEqual([
      {
        type: 'subscribe',
        outcome: 'failed',
        reason: 'unknown-publication',
      },
    ]);
  });

  it('notifies observer on applied subscribe request', async () => {
    const notifications: { type: string; outcome: ObserverOutcome; reason?: string | undefined }[] =
      [];
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = {
      onMessage(msg: { type: string }, outcome: ObserverOutcome, reason?: string) {
        notifications.push({ type: msg.type, outcome, reason });
      },
    };
    const pubs = new Publications(mongo, ws, observer);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(notifications).toHaveLength(1);
    expect(notifications).toEqual([{ type: 'subscribe', outcome: 'applied', reason: undefined }]);
  });

  it('replaces the watcher when the same client resubscribes with the same id', async () => {
    const notifications: { type: string; outcome: ObserverOutcome; reason?: string | undefined }[] =
      [];
    const mongo = MongoWrapper.createNull({
      find: [[], []],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = {
      onMessage(msg: { type: string }, outcome: ObserverOutcome, reason?: string) {
        notifications.push({ type: msg.type, outcome, reason });
      },
    };
    const pubs = new Publications(mongo, ws, observer);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(mongo.watcherCount('files')).toBe(1);

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(mongo.watcherCount('files')).toBe(1);
    expect(notifications).toContainEqual({
      type: 'subscribe',
      outcome: 'applied',
      reason: 'duplicate-sub-id',
    });

    const countAfterResub = client.messages.length;
    await mongo.insert('files', { name: 'still-one-watcher.bam' });

    const newMessages = client.messages.slice(countAfterResub);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]).toEqual(
      expect.objectContaining({
        type: 'added',
        collection: 'files',
      }),
    );
  });

  it('notifies observer when unsubscribe cannot find the sub id', async () => {
    const skipped: { type: string; outcome: ObserverOutcome; reason?: string | undefined }[] = [];
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = {
      onMessage(msg: { type: string }, outcome: ObserverOutcome, reason?: string) {
        skipped.push({ type: msg.type, outcome, reason });
      },
    };
    const pubs = new Publications(mongo, ws, observer);

    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    expect(skipped).toEqual([
      {
        type: 'unsubscribe',
        outcome: 'skipped',
        reason: 'unknown-sub-id',
      },
    ]);
  });

  it('continues normal behaviour if observer throws', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const observer = {
      onMessage: () => {
        throw new Error('observer failed');
      },
    };
    const pubs = new Publications(mongo, ws, observer);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await expect(
      pubs.handleMessage(client.id, {
        type: 'subscribe',
        id: 'sub1',
        name: 'files.all',
      }),
    ).resolves.not.toThrow();

    expect(client.messages).toContainEqual({
      type: 'ready',
      id: 'sub1',
      collection: 'files',
    });
  });

  it('sends initial documents and ready signal on subscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(client.messages).toHaveLength(2);
    expect(client.messages).toEqual([
      {
        type: 'added',
        collection: 'files',
        id: '1',
        fields: { name: 'existing.bam' },
      },
      {
        type: 'ready',
        id: 'sub1',
        collection: 'files',
      },
    ]);
  });

  it('sends ready even when no documents exist', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]).toEqual({ type: 'ready', id: 'sub1', collection: 'files' });
  });

  it('pushes live changes to subscribed clients', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    const countAfterSubscribe = client.messages.length;
    expect(countAfterSubscribe).toBe(1);

    await mongo.insert('files', { name: 'new.bam' });

    const newMessages = client.messages.slice(countAfterSubscribe);
    expect(newMessages).toHaveLength(1);
    expect(newMessages).toContainEqual(
      expect.objectContaining({
        type: 'added',
        collection: 'files',
      }),
    );
  });

  it('stops sending updates after unsubscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    const countAfterUnsub = client.messages.length;

    await mongo.insert('files', { name: 'should-not-appear.bam' });

    const newMessages = client.messages.slice(countAfterUnsub);
    expect(newMessages).toHaveLength(0);
  });

  it('does not leak watchers on repeated subscribe/unsubscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[], [], []],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    for (let i = 0; i < 3; i++) {
      await pubs.handleMessage(client.id, {
        type: 'subscribe',
        id: `sub${String(i)}`,
        name: 'files.all',
      });
      await pubs.handleMessage(client.id, {
        type: 'unsubscribe',
        id: `sub${String(i)}`,
      });
    }

    const countAfterAll = client.messages.length;

    await mongo.insert('files', { name: 'leaked.bam' });

    const newMessages = client.messages.slice(countAfterAll);
    expect(newMessages).toHaveLength(0);
    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('tears down watchers when a client disconnects without unsubscribing', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(mongo.watcherCount('files')).toBe(1);

    client.close();

    expect(mongo.watcherCount('files')).toBe(0);
  });

  it('tears down only the disconnecting client and leaves others intact', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[], []],
    });
    const ws = WebSocketWrapper.createNull();
    const clientA = ws.simulateConnection();
    const clientB = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(clientA.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });
    await pubs.handleMessage(clientB.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(mongo.watcherCount('files')).toBe(2);

    clientA.close();

    expect(mongo.watcherCount('files')).toBe(1);

    const countAfterClose = clientB.messages.length;
    await mongo.insert('files', { name: 'still-flowing.bam' });
    const newForB = clientB.messages.slice(countAfterClose);
    expect(newForB).toHaveLength(1);
  });

  it('keys subscriptions per client so two clients can pick the same sub id', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[], []],
    });
    const ws = WebSocketWrapper.createNull();
    const clientA = ws.simulateConnection();
    const clientB = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(clientA.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });
    await pubs.handleMessage(clientB.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    await pubs.handleMessage(clientA.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    expect(mongo.watcherCount('files')).toBe(1);

    const countAfterUnsub = clientB.messages.length;
    await mongo.insert('files', { name: 'for-b.bam' });
    const newForB = clientB.messages.slice(countAfterUnsub);
    expect(newForB).toHaveLength(1);
  });

  it('handles disconnect for a client that never subscribed', () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const neverSubscribed = ws.simulateConnection();
    new Publications(mongo, ws);

    expect(() => {
      neverSubscribed.close();
    }).not.toThrow();
  });

  it('server sends removed messages for the documents it sent on clients unsubscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    const countAfterSubscribe = client.messages.length;

    expect(countAfterSubscribe).toBe(2);

    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    const newMessages = client.messages.slice(countAfterSubscribe);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]).toEqual({
      type: 'removed',
      collection: 'files',
      id: '1',
    });
  });

  it('passes subscribe params to the publication query', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'in-folder.bam', folderId: 'folder-a' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    let receivedParams: unknown;
    pubs.define('files.byFolder', (params) => {
      receivedParams = params;
      return {
        collection: 'files',
        query: { folderId: (params as { folderId: string }).folderId },
      };
    });

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.byFolder',
      params: { folderId: 'folder-a' },
    });

    expect(receivedParams).toEqual({ folderId: 'folder-a' });
  });

  it('rejects subscribe params that smuggle mongo operators', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    let queryFnCalled = false;
    pubs.define('files.byFolder', (params) => {
      queryFnCalled = true;
      const folderId = (params as { folderId: string }).folderId;
      return { collection: 'files', query: { folderId } };
    });

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.byFolder',
      params: { folderId: { $ne: null } },
    });

    expect(queryFnCalled).toBe(false);
    expect(client.messages).toContainEqual(expect.objectContaining({ type: 'error', id: 'sub1' }));
  });

  it('sends an error to the client when the publication query throws', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const notifications: { outcome: ObserverOutcome; reason?: PublicationsReasons | undefined }[] =
      [];
    const observer: PublicationsObserver = {
      onMessage(_msg, outcome, reason) {
        notifications.push({ outcome, reason });
      },
    };
    const pubs = new Publications(mongo, ws, observer);

    pubs.define('files.byFolder', (params) => {
      if (typeof (params as { folderId?: unknown }).folderId !== 'string') {
        throw new Error('folderId is required and must be a string');
      }
      return { collection: 'files', query: {} };
    });

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.byFolder',
      params: {},
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'sub1',
      error: {
        code: 400,
        message: 'Publication query failed: folderId is required and must be a string',
      },
    });

    expect(notifications).toContainEqual(expect.objectContaining({ outcome: 'failed' }));
  });

  it('server sends removed messages for the documents it sent on clients unsubscribe', async () => {
    const mongo = MongoWrapper.createNull({
      find: [[{ _id: '1', name: 'existing.bam' }]],
    });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    const countAfterSubscribe = client.messages.length;

    expect(countAfterSubscribe).toBe(2);

    await pubs.handleMessage(client.id, {
      type: 'unsubscribe',
      id: 'sub1',
    });

    const newMessages = client.messages.slice(countAfterSubscribe);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]).toEqual({
      type: 'removed',
      collection: 'files',
      id: '1',
    });
  });
  it('sends removed on unsubscribe for documents added through the live watch', async () => {
    const mongo = MongoWrapper.createNull({ find: [[]] });
    const ws = WebSocketWrapper.createNull();
    const client = ws.simulateConnection();
    const pubs = new Publications(mongo, ws);

    pubs.define('files.all', () => ({ collection: 'files', query: {} }));

    await pubs.handleMessage(client.id, { type: 'subscribe', id: 'sub1', name: 'files.all' });

    await mongo.insert('files', { name: 'live.bam' });

    const added = client.messages.find(
      (m): m is { type: string; id: string } =>
        typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'added',
    );
    expect(added?.id).toBeTruthy();

    const countBeforeUnsub = client.messages.length;
    await pubs.handleMessage(client.id, { type: 'unsubscribe', id: 'sub1' });

    expect(client.messages.slice(countBeforeUnsub)).toEqual([
      { type: 'removed', collection: 'files', id: added?.id },
    ]);
  });
});
