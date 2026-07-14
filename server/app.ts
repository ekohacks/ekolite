import { MongoWrapper } from './infrastructure/mongo.ts';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { FileStorageWrapper } from './infrastructure/fileStorage.ts';
import { ScriptRunnerWrapper } from './infrastructure/scriptRunner.ts';
import { Publications } from './logic/publications.ts';
import { RpcHandler } from './logic/rpcHandler.ts';
import { Methods } from './logic/methods.ts';
import { Files } from './logic/files.ts';
import { type StoredFile } from '../shared/types.ts';

// Config for the real boot. The same knobs start.ts reads from the environment.
export interface AppConfig {
  mongoUri: string;
  fileDir: string;
  port: number;
}

// The wrappers App is built from, whether real or Nulled. create() and createNull()
// differ only in what they put here; everything downstream is the same wiring.
interface AppParts {
  mongo: MongoWrapper;
  ws: WebSocketWrapper;
  storage: FileStorageWrapper;
  scriptRunner: ScriptRunnerWrapper;
}

// Test affordances for createNull. scriptResponses is the stdout the Nulled runner
// answers with, keyed by command. findResponses is the queue of results the Nulled
// Mongo returns from find, one per call (e.g. [[file], [file]] answers a subscribe
// then a locate), the same shape MongoWrapper.createNull takes. ws lets an
// end-to-end test inject a real socket so the assembled app can be driven over the
// wire while the data infrastructure stays Nulled.
type ScriptResponses = Parameters<typeof ScriptRunnerWrapper.createNull>[0];

interface NullConfig {
  scriptResponses?: ScriptResponses;
  findResponses?: StoredFile[][];
  mongo?: MongoWrapper;
  ws?: WebSocketWrapper;
}

// The application layer. One place the subsystems are wired: the socket, the
// publications engine over Mongo, the method registry behind the RPC handler, the
// file store behind uploads, and the script runner. create() supplies real
// infrastructure, createNull() supplies Nulled infrastructure, and the constructor
// wires both the same way. Logic classes never learn which kind of wrapper they got.
//
// What App does not do is define anything. It wires infrastructure into logic and
// stops. A consumer's App.create() comes back with empty registries, and whatever they
// define is all that is on them. EkoLite's own demo definitions live in demo.ts, which
// start.ts calls; the framework does not carry them.
export class App {
  readonly ws: WebSocketWrapper;
  readonly publications: Publications;
  readonly methods: Methods;
  readonly files: Files;
  readonly rpcHandler: RpcHandler;
  // Running a script is a framework capability, so the wrapper stays wired here and is
  // reachable. Which script, and what method calls it, is the caller's business.
  readonly scriptRunner: ScriptRunnerWrapper;
  private readonly mongo: MongoWrapper;

  private constructor(parts: AppParts) {
    this.ws = parts.ws;
    this.mongo = parts.mongo;
    this.scriptRunner = parts.scriptRunner;
    this.methods = new Methods();
    this.rpcHandler = new RpcHandler(this.methods, parts.ws);
    this.publications = new Publications(parts.mongo, parts.ws);
    this.files = new Files(parts.mongo, parts.storage);
  }

  static create(config: AppConfig): App {
    return new App({
      mongo: MongoWrapper.create(config.mongoUri),
      ws: WebSocketWrapper.create(),
      storage: FileStorageWrapper.create(config.fileDir),
      scriptRunner: ScriptRunnerWrapper.create(),
    });
  }

  static createNull(nullConfig: NullConfig = {}): App {
    if (nullConfig.mongo && nullConfig.findResponses) {
      throw new Error('App.createNull received both mongo and findResponses; use one or the other');
    }

    const mongo =
      nullConfig.mongo ??
      (nullConfig.findResponses
        ? MongoWrapper.createNull({ find: nullConfig.findResponses })
        : MongoWrapper.createNull());

    return new App({
      mongo,
      ws: nullConfig.ws ?? WebSocketWrapper.createNull(),
      storage: FileStorageWrapper.createNull(),
      scriptRunner: ScriptRunnerWrapper.createNull(nullConfig.scriptResponses ?? {}),
    });
  }

  // Graceful shutdown. Closing the socket also closes the Fastify server it
  // attached to; then the publications' change streams are drained; then the Mongo
  // connection goes. Order matters: stop taking requests, stop the streams, and only
  // then drop the database, so it never closes with a change stream open underneath.
  async close(): Promise<void> {
    const stack = new AsyncDisposableStack();
    // Disposal runs in reverse registration order, so register the teardown backwards:
    // ws closes first, mongo last.
    stack.defer(() => this.mongo.close());
    stack.defer(() => this.publications.stopAll());
    stack.defer(() => this.ws.close());

    await stack.disposeAsync();
  }
}
