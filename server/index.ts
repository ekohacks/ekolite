import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer() {
  const server = Fastify();

  await server.register(fastifyStatic, {
    root: resolve(__dirname, '..', 'dist', 'client'),
  });

  return server;
}
