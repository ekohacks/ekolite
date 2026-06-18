import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { type Publications } from './logic/publications.ts';
import { type ClientMessage } from '../shared/protocol.ts';

export interface ServerOptions {
  ws: WebSocketWrapper;
  publications?: Publications;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer(options: ServerOptions) {
  const server = Fastify();

  await server.register(fastifyStatic, {
    root: resolve(__dirname, '..', 'dist', 'client'),
  });
  await options.ws.attach(server);

  const publications = options.publications;
  if (publications) {
    options.ws.onMessage((clientId, message) => {
      void publications.handleMessage(clientId, message as ClientMessage);
    });
  }

  return server;
}
