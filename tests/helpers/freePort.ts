import net from 'node:net';

// A fresh ephemeral port per run, so an integration test never collides with the 3001
// that `npm run dev:server` binds. The probe releases the port before the caller binds
// it, which is a race on paper; the kernel does not reissue an ephemeral port that fast.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not reserve a free port'));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}
