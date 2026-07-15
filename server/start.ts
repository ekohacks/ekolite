import { resolve } from 'node:path';
import { createServer } from './index.ts';
import { App, type AppConfig } from './app.ts';
import { defineDemo, DEFAULT_COUNTC_SCRIPT } from './demo.ts';
import { ProcessWrapper } from './infrastructure/process.ts';
import { Shutdown } from './logic/shutdown.ts';
import { READY_MESSAGE } from '../shared/serverMessages.ts';

// Real boot. Read config from the environment, let App wire the graph (Mongo, the
// websocket, the pub/sub engine, the file store and the script runner), define the
// demo on top of it, then serve it over Fastify. The wiring that used to live here
// now lives in App.create, so the same assembly the end-to-end test drives is the one
// that boots in production.
//
// The demo definitions are ours, not the framework's, which is why defineDemo is called
// here rather than baked into App. A consumer who installs ekolite calls App.create and
// gets an empty stage; this file is what puts EkoLite's own furniture on it.
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
defineDemo(app, { countCScript: process.env.COUNTC_SCRIPT ?? DEFAULT_COUNTC_SCRIPT });

// EkoLite's own demo home page, the only thing this boot serves statically. vite builds it
// to dist/demo, resolved against the working directory rather than this file's location.
// cwd is the anchor because it lands on dist/demo whether start.ts runs from source or as a
// built dist/server/start.js, where a path relative to this file would not. It is the same
// project-root-relative convention the countC script above is found by, since that is where
// this process is booted from.
const demoRoot = resolve(process.cwd(), 'dist', 'demo');
const server = await createServer({
  ws: app.ws,
  publications: app.publications,
  rpcHandler: app.rpcHandler,
  files: app.files,
  staticRoot: demoRoot,
});
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
