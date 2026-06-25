import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { type Publications } from './logic/publications.ts';
import { type Files } from './logic/files.ts';
import { type RpcHandler } from './logic/rpcHandler.ts';
import { type ClientMessage } from '../shared/protocol.ts';
import { RpcError, toEkoLiteError } from '../shared/types.ts';

export interface ServerOptions {
  ws: WebSocketWrapper;
  publications?: Publications;
  rpcHandler?: RpcHandler;
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
  const rpcHandler = options.rpcHandler;

  if (publications || rpcHandler) {
    options.ws.onMessage((clientId, message) => {
      const clientMessage = message as ClientMessage;

      switch (clientMessage.type) {
        case 'method':
          if (rpcHandler) {
            void rpcHandler.handleMessage(clientId, clientMessage);
          }
          break;
        case 'subscribe':
        case 'unsubscribe':
          if (publications) {
            void publications.handleMessage(clientId, clientMessage);
          }
          break;
        default:
          break;
      }
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
      try {
        const stored = await files.upload({
          name: upload.filename,
          type: upload.mimetype,
          data: await upload.toBuffer(),
        });
        reply.status(201).send({ id: stored._id, name: stored.name });
        return;
      } catch (err) {
        if (err instanceof RpcError) {
          reply.status(err.code).send(toEkoLiteError(err));
          return;
        }

        reply.status(500).send({
          code: 500,
          message: 'Internal Server Error',
        });
        return;
      }
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
