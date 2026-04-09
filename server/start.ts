import { createServer } from './index.ts';

const server = await createServer();
await server.listen({ port: 3001 });
console.log('http://localhost:3001');
