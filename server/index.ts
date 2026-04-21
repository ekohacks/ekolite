import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketWrapper } from './infrastructure/websocket.ts';

export interface ServerOptions {
  ws: WebSocketWrapper;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer(options: ServerOptions) {
  const server = Fastify();

  await server.register(fastifyStatic, {
    root: resolve(__dirname, '..', 'dist', 'client'),
  });
  await options.ws.attach(server);
  return server;
}
