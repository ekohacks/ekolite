import { describe, it, expect } from 'vitest';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';

describe('FileStorageWrapper (null)', () => {
  it('saves a file and confirms it exists', async () => {
    const storage = FileStorageWrapper.createNull();
    await storage.save('test.bam', Buffer.from('content'));
    expect(await storage.exists('test.bam')).toBe(true);
  });

  it('returns false for a file that does not exist', async () => {
    const storage = FileStorageWrapper.createNull();
    expect(await storage.exists('nope.bam')).toBe(false);
  });

  it('removes a file', async () => {
    const storage = FileStorageWrapper.createNull();
    await storage.save('test.bam', Buffer.from('content'));
    await storage.remove('test.bam');
    expect(await storage.exists('test.bam')).toBe(false);
  });

  it('resolves to an absolute path', () => {
    const storage = FileStorageWrapper.createNull();
    const resolved = storage.resolve('test.bam');
    expect(resolved).toMatch(/^\/|^[A-Z]:/);
  });

  it('rejects save with empty name', async () => {
    const storage = FileStorageWrapper.createNull();
    await expect(storage.save('', Buffer.from('content'))).rejects.toThrow(
      'File name cannot be empty',
    );
  });
});
