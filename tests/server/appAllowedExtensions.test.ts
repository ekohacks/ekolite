import { describe, it, expect } from 'vitest';
import { App } from '../../server/app.ts';

// The upload routes accept .bam and nothing else. A project moving .txt or .csv has no
// way to say so: App builds Files with no options, so the hardcoded single-entry default
// is the whole story for anyone booting through `ekolite run`.
//
// Red for the wiring only. Files already takes { allowedExtensions } and is already
// tested on it in tests/logic/files.test.ts, so the logic is not in question. What is
// missing is the seam from a consumer's configuration down to that constructor.
//
// The unconfigured default stays ['bam'] deliberately: widening is opt in, so upgrading
// from 0.4.2 cannot silently start accepting file types a deployment was rejecting
// yesterday. That matters more than usual while the file routes still have no auth.
describe('App carries the configured upload extensions', () => {
  it('accepts only .bam when nothing is configured', () => {
    const app = App.createNull();

    expect(app.files.validate('reads.bam')).toBe(true);
    expect(app.files.validate('notes.txt')).toBe(false);
  });

  it('accepts the extensions it was configured with', () => {
    const app = App.createNull({ allowedExtensions: ['bam', 'txt'] });

    expect(app.files.validate('reads.bam')).toBe(true);
    expect(app.files.validate('notes.txt')).toBe(true);
  });

  it('rejects what the configured list leaves out', () => {
    const app = App.createNull({ allowedExtensions: ['txt'] });

    expect(app.files.validate('reads.bam')).toBe(false);
  });
});
