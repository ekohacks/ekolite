import fastifyWebsocket from '@fastify/websocket';
import { FastifyInstance } from 'fastify';

export async function websocketRoute(app: FastifyInstance) {
  await app.register(fastifyWebsocket);

  app.get('/ws', { websocket: true }, (socket) => {
    console.log(socket);
  });
}
