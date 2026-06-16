import { describe, it, expect } from 'vitest';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';
import { fileStorageContract } from './fileStorageContract.ts';

describe('FileStorageWrapper (null)', () => {
  // Same behaviour the real adapter is held to in the integration suite.
  fileStorageContract(() => FileStorageWrapper.createNull());

  it('tracks save, exists, and remove operations', async () => {
    const storage = FileStorageWrapper.createNull();
    const tracker = storage.trackChanges();

    await storage.save('test.bam', Buffer.from('content'));
    await storage.exists('test.bam');
    await storage.remove('test.bam');

    expect(tracker.data).toHaveLength(3);
    expect(tracker.data[0]).toMatchObject({ type: 'save', name: 'test.bam' });
    expect(tracker.data[0]).toHaveProperty('data');
    expect(tracker.data[1]).toMatchObject({ type: 'exists', name: 'test.bam', exists: true });
    expect(tracker.data[2]).toMatchObject({ type: 'remove', name: 'test.bam' });
  });

  it('notifies a watcher of a save without trackChanges being called first', async () => {
    const events: unknown[] = [];
    const storage = FileStorageWrapper.createNull();
    const stop = storage.watch((event) => events.push(event));

    await storage.save('watched.bam', Buffer.from('content'));
    stop();

    expect(events).toEqual([{ type: 'save', name: 'watched.bam', data: Buffer.from('content') }]);
  });

  it('throws configured save errors without mutating the store', async () => {
    const storage = FileStorageWrapper.createNull({
      save: [new Error('Disk full')],
    });
    const tracker = storage.trackChanges();

    await expect(storage.save('test.bam', Buffer.from('content'))).rejects.toThrow('Disk full');
    await expect(storage.exists('test.bam')).resolves.toBe(false);
    expect(tracker.data).toEqual([{ type: 'exists', name: 'test.bam', exists: false }]);
  });

  it('throws configured remove errors without deleting the file', async () => {
    const storage = FileStorageWrapper.createNull({
      remove: [new Error('Permission denied')],
    });
    const tracker = storage.trackChanges();

    await storage.save('test.bam', Buffer.from('content'));
    await expect(storage.remove('test.bam')).rejects.toThrow('Permission denied');
    await expect(storage.exists('test.bam')).resolves.toBe(true);
    expect(tracker.data[0]).toMatchObject({ type: 'save', name: 'test.bam' });
    expect(tracker.data[1]).toMatchObject({ type: 'exists', name: 'test.bam', exists: true });
    expect(tracker.data).toHaveLength(2);
  });

  it('throws configured exists errors', async () => {
    const storage = FileStorageWrapper.createNull({
      exists: [new Error('Stat failed')],
    });
    const tracker = storage.trackChanges();

    await expect(storage.exists('test.bam')).rejects.toThrow('Stat failed');
    expect(tracker.data).toEqual([]);
  });

  it('resolves to an absolute path', () => {
    const storage = FileStorageWrapper.createNull();
    expect(storage.resolve('test.bam')).toMatch(/^\/|^[A-Z]:/);
  });

  // Wrapper guard, not adapter behaviour: save throws before reaching the adapter,
  // so it is the same for real and null and belongs here, not in the contract.
  it('rejects a save with an empty name', async () => {
    const storage = FileStorageWrapper.createNull();
    await expect(storage.save('', Buffer.from('content'))).rejects.toThrow(
      'File name cannot be empty',
    );
  });
});
