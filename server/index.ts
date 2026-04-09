import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { websocketRoute } from './plugins/websocketRoutes.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer() {
  const server = Fastify();

  await server.register(fastifyStatic, {
    root: resolve(__dirname, '..', 'dist', 'client'),
  });
  await server.register(websocketRoute);
  return server;
}
