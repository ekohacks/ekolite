import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { type Publications } from './logic/publications.ts';
import { type Files } from './logic/files.ts';
import { type RpcHandler } from './logic/rpcHandler.ts';
import { type ClientMessage, type PongMsg } from '../shared/protocol.ts';
import { RpcError, toEkoLiteError } from '../shared/types.ts';

// Public package surface for the `ekolite` entry: the app graph and its config sit
// alongside createServer, so a consumer imports the whole server framework from one place.
export { App, type AppConfig } from './app.ts';

// App.close() rejects with a SuppressedError when more than one closer fails, and that
// error hides its causes on non-enumerable properties. flattenSuppressed is how they are
// read, so it ships with the thing that throws it rather than staying an internal.
export { flattenSuppressed } from '../shared/helperFunctions.ts';

export interface ServerOptions {
  ws: WebSocketWrapper;
  publications?: Publications;
  rpcHandler?: RpcHandler;
  files?: Files;
  // The directory of static files served at /. It is the caller's client, not ours:
  // start.ts points it at EkoLite's built demo, a consumer points it at their own build.
  // Left undefined, createServer registers no static handler at all. That is deliberate: an
  // absent root is an honest 'serves nothing', not a Fastify that looks healthy and 404s
  // every static request, which is what a root that silently fails to resolve would give.
  staticRoot?: string;
}

export async function createServer(options: ServerOptions) {
  const server = Fastify();

  server.setErrorHandler((err, _request, reply) => {
    const error = toEkoLiteError(err);

    reply.status(error.code).send(error);
  });

  if (options.staticRoot !== undefined) {
    await server.register(fastifyStatic, { root: options.staticRoot });
  }
  await options.ws.attach(server);

  const publications = options.publications;
  const rpcHandler = options.rpcHandler;

  // Always registered, never gated on publications or an rpcHandler. The heartbeat belongs
  // to the transport: a socket has to be able to prove it is alive before anything is
  // published or called on it, and a client whose ping goes unanswered concludes the
  // connection is dead and closes it.
  options.ws.onMessage((clientId, message) => {
    const clientMessage = message as ClientMessage;

    switch (clientMessage.type) {
      case 'ping':
        // exactOptionalPropertyTypes: an absent id and an explicit undefined are different
        // types, so the id is only carried back when the ping actually sent one.
        options.ws.send(
          clientId,
          clientMessage.id === undefined
            ? ({ type: 'pong' } satisfies PongMsg)
            : ({ type: 'pong', id: clientMessage.id } satisfies PongMsg),
        );
        break;
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

  const files = options.files;
  if (files) {
    await server.register(fastifyMultipart);
    server.post('/api/files', async (request, reply) => {
      const upload = await request.file();

      if (!upload) {
        throw new RpcError(400, 'no file in request');
      }

      const stored = await files.upload({
        name: upload.filename,
        type: upload.mimetype,
        data: await upload.toBuffer(),
      });

      return reply.status(201).send({
        id: stored._id,
        name: stored.name,
      });
    });

    server.get('/api/files/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await files.read(id);
      if (!result) {
        throw new RpcError(404, 'file not found');
      }
      reply.header('content-type', 'application/octet-stream');
      reply.header('content-disposition', `attachment; filename="${result.file.name}"`);
      return reply.send(result.data);
    });
  }

  return server;
}
