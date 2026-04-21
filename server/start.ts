import { createServer } from './index.ts';
import { WebSocketWrapper } from './infrastructure/websocket.ts';

const ws = WebSocketWrapper.create();

const server = await createServer({ ws });
await server.listen({ port: 3001 });
