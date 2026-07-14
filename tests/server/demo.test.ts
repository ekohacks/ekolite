import { describe, it, expect } from 'vitest';
import { App } from '../../server/app.ts';
import { defineDemo } from '../../server/demo.ts';
import { StoredFile } from '../../shared/types.ts';

// 8.E — the demo definitions moved out of App and into demo.ts, so these are the tests
// that used to live in app.test.ts asserting App registered them. The behaviour did not
// change, only its owner: what the framework used to hand every consumer, the demo boot
// now asks for by name.

const bamFile = (id: string): StoredFile => ({
  _id: id,
  name: 'reads.bam',
  path: `/data/${id}.bam`,
  size: 9,
  extension: 'bam',
  uploadedAt: new Date(),
});

describe('the demo definitions', () => {
  it('defines echo on the app it is given', async () => {
    const app = App.createNull();

    defineDemo(app);

    expect(await app.methods.call('echo', ['ping'])).toBe('echo: ping');
  });

  it('defines runCountC, wired to the app files and its script runner', async () => {
    const app = App.createNull({
      scriptResponses: { python3: '7' },
      findResponses: [[bamFile('f1')]],
    });

    defineDemo(app);

    // locate('f1') finds the seeded document, the runner answers '7', the count comes
    // back to the caller: proof defineDemo reached the app's own nulled script runner.
    expect(await app.methods.call('runCountC', ['f1'])).toBe(7);
  });

  it('defines the files.all publication', async () => {
    const app = App.createNull({ findResponses: [[bamFile('f1')]] });
    const client = app.ws.simulateConnection();

    defineDemo(app);

    await app.publications.handleMessage(client.id, {
      type: 'subscribe',
      id: 'sub1',
      name: 'files.all',
    });

    expect(client.messages).toContainEqual(expect.objectContaining({ type: 'ready', id: 'sub1' }));
  });
});
