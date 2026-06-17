import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { type Publications } from './logic/publications.ts';
import { type Files } from './logic/files.ts';
import { type ClientMessage } from '../shared/protocol.ts';

export interface ServerOptions {
  ws: WebSocketWrapper;
  publications?: Publications;
  files?: Files;
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

  const files = options.files;
  if (files) {
    await server.register(fastifyMultipart);
    server.post('/api/files', async (request, reply) => {
      const upload = await request.file();
      if (!upload) {
        return reply.status(400).send({ error: 'no file in request' });
      }
      const stored = await files.upload({
        name: upload.filename,
        type: upload.mimetype,
        data: await upload.toBuffer(),
      });
      return reply.status(201).send({ id: stored._id, name: stored.name });
    });

    server.get('/api/files/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await files.read(id);
      if (!result) {
        return reply.status(404).send({ error: 'file not found' });
      }
      reply.header('content-type', 'application/octet-stream');
      reply.header('content-disposition', `attachment; filename="${result.file.name}"`);
      return reply.send(result.data);
    });
  }

  return server;
}
