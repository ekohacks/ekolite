import { createServer } from './index.ts';
import { App, type AppConfig } from './app.ts';

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
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      process.exit(0);
    })();
  });
}
