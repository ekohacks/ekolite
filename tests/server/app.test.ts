import { describe, it, expect } from 'vitest';
import { App } from '../../server/app.ts';
import { Publications } from '../../server/logic/publications.ts';
import { Methods } from '../../server/logic/methods.ts';
import { Files } from '../../server/logic/files.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';
import { StoredFile } from '../../shared/types.ts';

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

  it('registers echo, callable through the assembled methods', async () => {
    const app = App.createNull();

    expect(await app.methods.call('echo', ['ping'])).toBe('echo: ping');
  });

  it('registers runCountC, wired to files and the nulled script runner', async () => {
    const app = App.createNull({
      scriptResponses: { python3: '7' },
      findResponses: [[bamFile('f1')]],
    });

    // locate('f1') finds the seeded document, the runner answers '7', the count
    // comes back to the caller: proof the scriptResponses reached the Nulled runner.
    expect(await app.methods.call('runCountC', ['f1'])).toBe(7);
  });

  it('registers the files.all publication', async () => {
    const app = App.createNull({ findResponses: [[bamFile('f1')]] });
    const client = app.ws.simulateConnection();

    await app.publications.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    // A registered publication runs its query and readies the subscription; an
    // unknown name comes back as a 404 error instead (the control below).
    expect(client.messages).toContainEqual(expect.objectContaining({ type: 'ready', id: 'sub1' }));

    await app.publications.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub2',
      name: 'no-such-publication',
    });

    expect(client.messages).toContainEqual({
      type: 'error',
      id: 'sub2',
      error: { code: 404, message: 'Unknown publication: no-such-publication' },
    });
  });
});
