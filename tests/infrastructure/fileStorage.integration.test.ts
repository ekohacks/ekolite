import { describe, it, expect, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { fileStorageContract } from './fileStorageContract.ts';

const TEST_DIR = path.join(os.tmpdir(), 'ekolite-test-files');

describe('FileStorageWrapper (real)', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  // Same behaviour the null is held to in the unit suite. This is the run that
  // proves the null's claims against a real disk.
  fileStorageContract(() => FileStorageWrapper.create(TEST_DIR));

  it('resolves to an absolute path inside the base dir', () => {
    const storage = FileStorageWrapper.create(TEST_DIR);
    const resolved = storage.resolve('test.bam');
    expect(resolved).toMatch(/^\/|^[A-Z]:/);
    expect(resolved).toContain(TEST_DIR);
  });
});
