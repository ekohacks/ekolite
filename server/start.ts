import Fastify from 'fastify';
import { createServer } from './index.ts';
import { WebSocketWrapper } from './infrastructure/websocket.ts';

const fastify = Fastify();
const ws = WebSocketWrapper.create(fastify);

const server = await createServer({ ws });
await server.listen({ port: 3001 });
console.log('http://localhost:3001');
