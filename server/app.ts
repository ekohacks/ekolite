import { MongoWrapper } from './infrastructure/mongo.ts';
import { WebSocketWrapper } from './infrastructure/websocket.ts';
import { FileStorageWrapper } from './infrastructure/fileStorage.ts';
import { ScriptRunnerWrapper } from './infrastructure/scriptRunner.ts';
import { ProcessWrapper } from './infrastructure/process.ts';
import { Publications } from './logic/publications.ts';
import { RpcHandler } from './logic/rpcHandler.ts';
import { Methods } from './logic/methods.ts';
import { Files } from './logic/files.ts';
import { Shutdown } from './logic/shutdown.ts';
import { type StoredFile } from '../shared/types.ts';

// Config for the real boot. The same knobs start.ts reads from the environment, plus the
// upload allowlist, which is the project's own rather than the environment's. Left out, the
// Files default stands.
export interface AppConfig {
  mongoUri: string;
  fileDir: string;
  port: number;
  allowedExtensions?: string[];
}

// The wrappers App is built from, whether real or Nulled. create() and createNull()
// differ only in what they put here; everything downstream is the same wiring.
interface AppParts {
  mongo: MongoWrapper;
  ws: WebSocketWrapper;
  storage: FileStorageWrapper;
  scriptRunner: ScriptRunnerWrapper;
  proc: ProcessWrapper;
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
  // A Nulled process, injected so a test can drive a shutdown request and watch the exit
  // that armShutdown ends in. Left out, createNull supplies its own Nulled process.
  proc?: ProcessWrapper;
  // The upload allowlist a test boots the app with, so a Nulled app can be asked what it
  // accepts without a config file or a disk. Same key, same meaning as AppConfig's.
  allowedExtensions?: string[];
}

// What App configures rather than wires. Kept apart from AppParts so that stays a list of
// wrappers, and passed by both factories so a Nulled app honours the same policy a real one
// does.
interface AppOptions {
  allowedExtensions?: string[];
}

// Omit the key rather than set it to undefined: under exactOptionalPropertyTypes an absent
// allowlist and an undefined one are different types, and only the absent one lets Files
// fall through to its own default.
function appOptions(allowedExtensions?: string[]): AppOptions {
  return allowedExtensions === undefined ? {} : { allowedExtensions };
}

// The application layer. One place the subsystems are wired: the socket, the
// publications engine over Mongo, the method registry behind the RPC handler, the
// file store behind uploads, and the script runner. create() supplies real
// infrastructure, createNull() supplies Nulled infrastructure, and the constructor
// wires both the same way. Logic classes never learn which kind of wrapper they got.
//
// What App does not do is define anything. It wires infrastructure into logic and
// stops. A consumer's App.create() comes back with empty registries, and whatever they
// define is all that is on them; the framework carries no publications or methods of its
// own, the way `meteor run` boots your app rather than one of ours.
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
  private readonly proc: ProcessWrapper;

  private constructor(parts: AppParts, options: AppOptions = {}) {
    this.ws = parts.ws;
    this.mongo = parts.mongo;
    this.scriptRunner = parts.scriptRunner;
    this.proc = parts.proc;
    this.methods = new Methods();
    this.rpcHandler = new RpcHandler(this.methods, parts.ws);
    this.publications = new Publications(parts.mongo, parts.ws);
    this.files = new Files(parts.mongo, parts.storage, options);
  }

  static create(config: AppConfig): App {
    return new App(
      {
        mongo: MongoWrapper.create(config.mongoUri),
        ws: WebSocketWrapper.create(),
        storage: FileStorageWrapper.create(config.fileDir),
        scriptRunner: ScriptRunnerWrapper.create(),
        proc: ProcessWrapper.create(),
      },
      appOptions(config.allowedExtensions),
    );
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

    return new App(
      {
        mongo,
        ws: nullConfig.ws ?? WebSocketWrapper.createNull(),
        storage: FileStorageWrapper.createNull(),
        scriptRunner: ScriptRunnerWrapper.createNull(nullConfig.scriptResponses ?? {}),
        proc: nullConfig.proc ?? ProcessWrapper.createNull(),
      },
      appOptions(nullConfig.allowedExtensions),
    );
  }

  // Arm graceful shutdown. On a signal, a Ctrl+C, or a supervisor's stop message, close
  // the app within the grace period and exit: 0 if it drained cleanly, 1 if it did not.
  // This is the whole surface a consumer needs to stop a long-running server; the Shutdown
  // policy and the process it binds to stay inside the package. start.ts arms it the same
  // way, so EkoLite's own boot is just the first consumer of this method.
  armShutdown(options: { graceMs?: number } = {}): void {
    new Shutdown(this, this.proc, options).arm();
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
