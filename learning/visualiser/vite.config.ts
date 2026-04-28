import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const stub = fileURLToPath(new URL('./stubs/empty.ts', import.meta.url));

export default defineConfig({
  root: 'learning/visualiser',
  server: {
    port: 5174,
  },
  build: {
    outDir: '../../dist/visualiser',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      mongodb: stub,
      ws: stub,
      '@fastify/websocket': stub,
      fastify: stub,
    },
  },
  optimizeDeps: {
    exclude: ['mongodb', 'ws', '@fastify/websocket', 'fastify'],
  },
});
