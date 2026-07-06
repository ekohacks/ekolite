import { createServer } from './index.ts';
import { App, type AppConfig } from './app.ts';
import { ProcessWrapper } from './infrastructure/process.ts';
import { Shutdown } from './logic/shutdown.ts';

// Real boot. Read config from the environment, let App wire the graph (Mongo, the
// websocket, the pub/sub engine, the file store, and the standard files.all / echo /
// runCountC definitions), then serve it over Fastify. The wiring that used to live
// here now lives in App.create, so the same assembly the end-to-end test drives is
// the one that boots in production.
const config: AppConfig = {
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite',
  fileDir: process.env.FILE_DIR ?? './uploads',
  countCScript: process.env.COUNTC_SCRIPT ?? 'scripts/countC.py',
  port: Number(process.env.PORT ?? 3001),
};

const app = App.create(config);
const server = await createServer(app);
await server.listen({ port: config.port, host: '0.0.0.0' });

console.warn(`EkoLite listening on http://localhost:${String(config.port)} (ws at /ws)`);

// Graceful shutdown: stop taking requests, then drop the database connection.
// The policy (deadline, exit codes, second signal) lives in Shutdown, tested on
// the nulled process; the shell only wires it to the real one.
new Shutdown(app, ProcessWrapper.create()).arm();
