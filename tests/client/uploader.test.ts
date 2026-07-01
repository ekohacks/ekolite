import { describe, expect, it } from 'vitest';
import { Uploader } from '../../client/uploader.ts';
import { RpcError } from '../../shared/types.ts';

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

  it('rejects with the shared RpcError the rest of the app already uses', async () => {
    const uploader = Uploader.createNull({
      response: { status: 400, body: { code: 400, message: 'Unsupported file type: .txt' } },
    });

    await expect(
      uploader.upload(new File([Buffer.from('notes')], 'bad.txt')),
    ).rejects.toBeInstanceOf(RpcError);
  });

  it('completes every upload when two run concurrently', async () => {
    const uploader = Uploader.createNull({
      response: { status: 201, body: { id: 'f1', name: 'sample.bam' } },
    });
    const requests = uploader.trackRequests();

    const first = uploader.upload(new File([Buffer.from('A')], 'a.bam'));
    const second = uploader.upload(new File([Buffer.from('B')], 'b.bam'));

    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual({ id: 'f1', name: 'sample.bam' });
    expect(b).toEqual({ id: 'f1', name: 'sample.bam' });
    expect(requests.data).toHaveLength(2);
  }, 2000);

  it('records which file went out, not just the route', async () => {
    const uploader = Uploader.createNull({
      response: { status: 201, body: { id: 'f1', name: 'sample.bam' } },
    });
    const requests = uploader.trackRequests();

    await uploader.upload(new File([Buffer.from('BAMDATA')], 'sample.bam'));

    expect(requests.data).toContainEqual(
      expect.objectContaining({ method: 'POST', url: '/api/files', filename: 'sample.bam' }),
    );
  });

  it('rejects, rather than hanging, when a 2xx body is the wrong shape', async () => {
    const uploader = Uploader.createNull({
      response: {
        status: 201,
        body: { wrong: 'shape' },
      },
    });

    await expect(uploader.upload(new File([Buffer.from('x')], 'x.bam'))).rejects.toThrow(
      'Invalid upload response',
    );
  }, 2000);

  it('reports progress as the bytes go up', async () => {
    const uploader = Uploader.createNull({
      response: { status: 201, body: { id: 'f1', name: 'big.bam' } },
      progress: [
        { loaded: 25, total: 100 },
        { loaded: 100, total: 100 },
      ],
    });

    const percents: number[] = [];

    await uploader.upload(new File([Buffer.from('BAMDATA')], 'big.bam'), {
      onProgress: ({ percent }) => percents.push(percent),
    });

    expect(percents).toEqual([25, 100]);
  });
});
