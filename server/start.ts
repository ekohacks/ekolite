import { createServer } from './index.ts';
import { App, type AppConfig } from './app.ts';
import { ProcessWrapper } from './infrastructure/process.ts';
import { Shutdown } from './logic/shutdown.ts';
import { READY_MESSAGE } from '../shared/serverMessages.ts';

// Real boot. Read config from the environment, let App wire the graph (Mongo, the
// websocket, the pub/sub engine, the file store and the script runner), then serve it
// over Fastify.
//
// This is EkoLite's runnable entry, and it boots a bare server with no app of its own:
// no publications, no methods, no client to serve. A developer adds those on top the way
// they would in any framework, which is the point, the runner runs your app rather than
// one of ours. If it should serve a client, the app passes its directory to createServer
// as staticRoot; the framework hardcodes none.
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
  port: Number(process.env.EKOLITE_PORT ?? process.env.PORT ?? 3001),
};

const app = App.create(config);
const server = await createServer(app);
await server.listen({ port: config.port, host: '0.0.0.0' });

// Graceful shutdown: stop taking requests, then drop the database connection.
// The policy (deadline, exit codes, second signal) lives in Shutdown, tested on
// the nulled process; the shell only wires it to the real one.
//
// This must come before the ready line. Whoever reads that line may act on it at once,
// and a supervisor's first act is often to stop us. Announce first and there is a window
// where the server is listening and has no SIGTERM handler, so the default action kills
// it and the exit is (null, 'SIGTERM') rather than a clean 0. The window is microseconds
// wide and the child usually wins it, which is the worst size for a window to be.
new Shutdown(app, ProcessWrapper.create()).arm();

// The smoke test waits for this exact line on stdout, so it goes to stdout (not the
// stderr that console.warn writes to) and carries the port, so a spawned harness can
// confirm the server bound the one it was handed. Written directly because the lint
// rule reserves console for warn/error.
//
// Ready means ready: bound, serving, and able to be stopped.
process.stdout.write(`${READY_MESSAGE} http://localhost:${String(config.port)}\n`);
