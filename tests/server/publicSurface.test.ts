import { describe, expect, it } from 'vitest';
import { App, flattenSuppressed } from '../../server/index.ts';
import { MongoWrapper } from '../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../server/infrastructure/websocket.ts';

// App.close() rejects with a SuppressedError when more than one closer fails, and a
// SuppressedError keeps .error and .suppressed non-enumerable: printing it shows a
// message and a stack, never the failures underneath. flattenSuppressed is the only
// way to read them, so it has to leave the package through the same door App does.
// Everything imported from '../../server/index.ts' below is what a consumer can reach.
describe('the ekolite entry point', () => {
  it('exports flattenSuppressed with App, so a consumer can read what close() rejects with', async () => {
    const mongo = MongoWrapper.createNull({ close: [new Error('mongo close failed')] });
    const ws = WebSocketWrapper.createNull({ close: [new Error('socket close failed')] });
    const app = App.createNull({ mongo, ws });

    const err: unknown = await app.close().catch((e: unknown) => e);

    expect(flattenSuppressed(err).map((e) => (e as Error).message)).toEqual([
      'socket close failed',
      'mongo close failed',
    ]);
  });
});
