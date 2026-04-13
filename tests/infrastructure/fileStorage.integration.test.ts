import { describe, it, expect, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { FileStorage } from '../../server/infrastructure/fileStorage.ts';
import os from 'node:os';

let TEST_DIR = `${os.tmpdir()}/ekolite-test-files`;

const plaform = os.platform();
if (plaform === 'win32') {
  TEST_DIR = `${os.tmpdir()}\\ekolite-test-files`;
}

describe('FileStorage (real)', () => {
  const storage = FileStorage.create(TEST_DIR);

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  it('saves a file and confirms it exists', async () => {
    await storage.save('test.bam', Buffer.from('content'));
    expect(await storage.exists('test.bam')).toBe(true);
  });

  it('returns false for a file that does not exist', async () => {
    expect(await storage.exists('nope.bam')).toBe(false);
  });

  it('removes a file', async () => {
    await storage.save('test.bam', Buffer.from('content'));
    await storage.remove('test.bam');
    expect(await storage.exists('test.bam')).toBe(false);
  });

  it('resolves to an absolute path', () => {
    const resolved = storage.resolve('test.bam');
    expect(resolved).toMatch(/^\/|^[A-Z]:/);
    expect(resolved).toContain(TEST_DIR);
  });

  it('rejects save with empty name', async () => {
    await expect(storage.save('', Buffer.from('content'))).rejects.toThrow(
      'File name cannot be empty',
    );
  });
});
