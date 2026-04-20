import { describe, expect, it } from 'vitest';
import { FileStorage } from '../../server/infrastructure/fileStorage.ts';

describe('FileStorage (null)', () => {
  it('saves a file and confirms it exists', async () => {
    const storage = FileStorage.createNull();
    await storage.save('test.bam', Buffer.from('content'));
    expect(await storage.exists('test.bam')).toBe(true);
  });

  it('tracks save, exists, and remove operations', async () => {
    const storage = FileStorage.createNull();
    const tracker = storage.trackChanges();

    await storage.save('test.bam', Buffer.from('content'));
    await storage.exists('test.bam');
    await storage.remove('test.bam');

    expect(tracker.data).toHaveLength(3);
    expect(tracker.data[0]).toMatchObject({
      type: 'save',
      name: 'test.bam',
    });
    expect(tracker.data[0]).toHaveProperty('data');
    expect(tracker.data[1]).toMatchObject({
      type: 'exists',
      name: 'test.bam',
      exists: true,
    });
    expect(tracker.data[2]).toMatchObject({
      type: 'remove',
      name: 'test.bam',
    });
  });

  it('returns false for a file that does not exist', async () => {
    const storage = FileStorage.createNull();
    expect(await storage.exists('nope.bam')).toBe(false);
  });

  it('removes a file', async () => {
    const storage = FileStorage.createNull();
    await storage.save('test.bam', Buffer.from('content'));
    await storage.remove('test.bam');
    expect(await storage.exists('test.bam')).toBe(false);
  });

  it('throws configured save errors without mutating the store', async () => {
    const storage = FileStorage.createNull({
      save: [new Error('Disk full')],
    });
    const tracker = storage.trackChanges();

    await expect(storage.save('test.bam', Buffer.from('content'))).rejects.toThrow('Disk full');
    await expect(storage.exists('test.bam')).resolves.toBe(false);
    expect(tracker.data).toEqual([
      {
        type: 'exists',
        name: 'test.bam',
        exists: false,
      },
    ]);
  });

  it('throws configured remove errors without deleting the file', async () => {
    const storage = FileStorage.createNull({
      remove: [new Error('Permission denied')],
    });
    const tracker = storage.trackChanges();

    await storage.save('test.bam', Buffer.from('content'));
    await expect(storage.remove('test.bam')).rejects.toThrow('Permission denied');
    await expect(storage.exists('test.bam')).resolves.toBe(true);
    expect(tracker.data[0]).toMatchObject({
      type: 'save',
      name: 'test.bam',
    });
    expect(tracker.data[1]).toMatchObject({
      type: 'exists',
      name: 'test.bam',
      exists: true,
    });
    expect(tracker.data).toHaveLength(2);
  });

  it('throws configured exists errors', async () => {
    const storage = FileStorage.createNull({
      exists: [new Error('Stat failed')],
    });
    const tracker = storage.trackChanges();

    await expect(storage.exists('test.bam')).rejects.toThrow('Stat failed');
    expect(tracker.data).toEqual([]);
  });

  it('resolves to an absolute path', () => {
    const storage = FileStorage.createNull();
    const resolved = storage.resolve('test.bam');
    expect(resolved).toMatch(/^\/|^[A-Z]:/);
  });

  it('rejects save with empty name', async () => {
    const storage = FileStorage.createNull();
    await expect(storage.save('', Buffer.from('content'))).rejects.toThrow(
      'File name cannot be empty',
    );
  });
});
