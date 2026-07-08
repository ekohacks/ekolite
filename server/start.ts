import { createServer } from './index.ts';
import { App, type AppConfig } from './app.ts';
import { ProcessWrapper } from './infrastructure/process.ts';
import { Shutdown } from './logic/shutdown.ts';

// Real boot. Read config from the environment, let App wire the graph (Mongo, the
// websocket, the pub/sub engine, the file store, and the standard files.all / echo /
// runCountC definitions), then serve it over Fastify. The wiring that used to live
// here now lives in App.create, so the same assembly the end-to-end test drives is
// the one that boots in production.
//
// EKOLITE_PORT and EKOLITE_MONGO_DB are the isolation knobs the smoke test sets so a
// spawned run never collides with `npm run dev:server` on 3001 or its data. A db name
// is expanded against the local replica set (rs0) because change streams need one.
const mongoDb = process.env.EKOLITE_MONGO_DB;
const config: AppConfig = {
  mongoUri: mongoDb
    ? `mongodb://localhost:27017/${mongoDb}?replicaSet=rs0`
    : (process.env.MONGO_URI ?? 'mongodb://localhost:27017/ekolite'),
  fileDir: process.env.FILE_DIR ?? './uploads',
  countCScript: process.env.COUNTC_SCRIPT ?? 'scripts/countC.py',
  port: Number(process.env.EKOLITE_PORT ?? process.env.PORT ?? 3001),
};

const app = App.create(config);
const server = await createServer(app);
await server.listen({ port: config.port, host: '0.0.0.0' });

// The smoke test waits for this exact line on stdout, so it goes to stdout (not the
// stderr that console.warn writes to) and carries the port, so a spawned harness can
// confirm the server bound the one it was handed. Written directly because the lint
// rule reserves console for warn/error.
process.stdout.write(`ekolite: ready on http://localhost:${String(config.port)}\n`);

// Graceful shutdown: stop taking requests, then drop the database connection.
// The policy (deadline, exit codes, second signal) lives in Shutdown, tested on
// the nulled process; the shell only wires it to the real one.
new Shutdown(app, ProcessWrapper.create()).arm();
