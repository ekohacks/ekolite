import { describe, it, expect } from 'vitest';
import { App } from '../../server/app.ts';
import { Publications } from '../../server/logic/publications.ts';
import { Methods } from '../../server/logic/methods.ts';
import { Files } from '../../server/logic/files.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { StoredFile } from '../../shared/types.ts';
import { flattenSuppressed } from '../../shared/helperFunctions.ts';

// 7.B.1 — App.createNull assembles all parts.
//
// App is the application layer: the one place publications, methods, uploads and
// the socket are wired together. start.ts does this by hand for the live process,
// and every server integration test repeats the same wiring. App.createNull() is
// that graph built on Nulled infrastructure, so it can be exercised with no Mongo,
// no python and no real socket.
//
// These tests prove the graph is assembled and the standard files.all / runCountC /
// echo definitions are registered. They stop there on purpose: the full
// connect -> upload -> analyse flow over a real socket is 7.B.2, the gate.
//
// scriptResponses feeds the Nulled ScriptRunnerWrapper; findResponses seeds the
// Nulled Mongo's find queue, one array of documents per find call (the same knob
// the reactive integration test uses through MongoWrapper.createNull).

const bamFile = (id: string): StoredFile => ({
  _id: id,
  name: 'reads.bam',
  path: `/data/${id}.bam`,
  size: 9,
  extension: 'bam',
  uploadedAt: new Date(),
});

describe('App.createNull assembles all parts', () => {
  it('exposes the wired subsystems', () => {
    const app = App.createNull();

    expect(app.publications).toBeInstanceOf(Publications);
    expect(app.methods).toBeInstanceOf(Methods);
    expect(app.files).toBeInstanceOf(Files);
    expect(app.ws).toBeInstanceOf(WebSocketWrapper);
  });

  // 8.E — the framework hands back an empty stage. A consumer's first line is
  // App.create(...), and what comes back must carry none of EkoLite's own demo:
  // no files.all, no echo, no runCountC. They belong to the demo boot, not to App.
  it('defines no methods of its own', async () => {
    const app = App.createNull();

    await expect(app.methods.call('echo', ['ping'])).rejects.toMatchObject({
      code: 404,
      message: 'Method not found: echo',
    });
    await expect(app.methods.call('runCountC', ['f1'])).rejects.toMatchObject({
      code: 404,
      message: 'Method not found: runCountC',
    });
  });

  it('defines no publications of its own', async () => {
    const app = App.createNull();
    const client = app.ws.simulateConnection();

    await app.publications.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'sub1',
      error: { code: 404, message: 'Unknown publication: files.all' },
    });
  });

  it('still closes Mongo when the nulled socket close rejects', async () => {
    const mongo = MongoWrapper.createNull();
    const closeTracker = mongo.trackClose();
    const ws = WebSocketWrapper.createNull({ close: [new Error('socket close failed')] });
    const app = App.createNull({ mongo, ws });

    await expect(app.close()).rejects.toThrow('socket close failed');

    expect(closeTracker.data).toHaveLength(1);
  });

  it('rejects with a SuppressedError carrying every failure, oldest first', async () => {
    const mongo = MongoWrapper.createNull({ close: [new Error('mongo close failed')] });
    const ws = WebSocketWrapper.createNull({ close: [new Error('socket close failed')] });
    const app = App.createNull({ mongo, ws });

    const err: unknown = await app.close().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SuppressedError);
    expect(flattenSuppressed(err).map((e) => (e as Error).message)).toEqual([
      'socket close failed',
      'mongo close failed',
    ]);
  });

  // Empty is not the same as broken. The registries start with nothing in them, and
  // whatever the caller defines works and is all that is there. The demo's own
  // definitions are asserted in demo.test.ts, where they now live.
  it('registers what the caller defines, and only that', async () => {
    const app = App.createNull({ findResponses: [[bamFile('f1')]] });
    const client = app.ws.simulateConnection();

    app.publications.define('tasks.mine', () => ({ collection: 'tasks', query: {} }));
    app.methods.define('addTask', (title) => Promise.resolve(`added: ${String(title)}`));

    expect(await app.methods.call('addTask', ['write the test'])).toBe('added: write the test');

    await app.publications.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'tasks.mine',
    });

    expect(client.messages).toContainEqual(expect.objectContaining({ type: 'ready', id: 'sub1' }));
  });

  it('rejects a config that sets both mongo and findResponses', () => {
    const mongo = MongoWrapper.createNull();
    expect(() => App.createNull({ mongo, findResponses: [[]] })).toThrow(/both|ambiguous/i);
  });
});
