import { it, expect } from 'vitest';
import { FileStorageWrapper } from '../../server/infrastructure/fileStorage.ts';

// The behaviour every FileStorageWrapper must honour, real or null. Run the same
// list against create() and createNull() so the null can never quietly drift from
// the real file system. If the two disagree, one of these fails.
export function fileStorageContract(makeStorage: () => FileStorageWrapper): void {
  it('reports a saved file as existing', async () => {
    const storage = makeStorage();
    await storage.save('report.bam', Buffer.from('content'));
    expect(await storage.exists('report.bam')).toBe(true);
  });

  it('reports a file that was never saved as absent', async () => {
    const storage = makeStorage();
    expect(await storage.exists('missing.bam')).toBe(false);
  });

  it('reports a removed file as gone', async () => {
    const storage = makeStorage();
    await storage.save('report.bam', Buffer.from('content'));
    await storage.remove('report.bam');
    expect(await storage.exists('report.bam')).toBe(false);
  });

  it('treats names that resolve to the same path as one file', async () => {
    const storage = makeStorage();
    await storage.save('./report.bam', Buffer.from('content'));
    expect(await storage.exists('report.bam')).toBe(true);
  });
}
