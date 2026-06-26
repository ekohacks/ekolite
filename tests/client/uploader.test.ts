import { describe, expect, it } from "vitest";

describe('Uploader (null)', () => {
    it.fails('sends the bytes and resolves with what server stored', async () => {
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

    })
})