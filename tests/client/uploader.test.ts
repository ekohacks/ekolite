import { describe, expect, it } from 'vitest';
import { Uploader } from '../../client/uploader.ts';

describe('Uploader (null)', () => {
  it('sends the bytes and resolves with what server stored', async () => {
    const uploader = Uploader.createNull({
      response: { status: 201, body: { id: 'f1', name: 'sample.bam' } },
    });
    const requests = uploader.trackRequests();

    const bam = new File([Buffer.from('BAMDATA')], 'sample.bam');
    const stored = await uploader.upload(bam);

    expect(requests.data).toContainEqual(
      expect.objectContaining({ method: 'POST', url: '/api/files' }),
    );
    expect(stored).toEqual({ id: 'f1', name: 'sample.bam' });
  });

  it('rejects with server error when the upload is refused', async () => {
    const uploader = Uploader.createNull({
      response: { status: 400, body: { code: 400, message: 'Unsupported file type: .txt' } },
    });

    const bad = new File([Buffer.from('notes')], 'bad.txt');

    await expect(uploader.upload(bad)).rejects.toMatchObject({
      code: 400,
      message: 'Unsupported file type: .txt',
    });
  });
});
