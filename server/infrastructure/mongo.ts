import { Collection, MongoClient as Driver, ObjectId } from 'mongodb';
import { ChangeEvent, isChangeEvent } from '../../shared/types.ts';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

const CLOSE_EVENT = 'close';

interface CollectionLike {
  find<T>(query: object): Promise<T[]>;
  insertOne(doc: object): Promise<void>;
  updateMany(query: object, changes: object): Promise<void>;
  deleteMany(query: object): Promise<void>;
  watch(onChange: (raw: unknown) => void): Promise<() => Promise<void>>;
}

type CollectionFactory = (name: string) => CollectionLike;

interface StubbedMongoOptions {
  find?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  remove?: unknown[];
  close?: unknown[];
}

export class MongoWrapper {
  private readonly collectionFactory: CollectionFactory;
  private readonly emitter = new EventEmitter();
  private readonly activeWatches = new Map<string, Promise<() => Promise<void>>>();

  private readonly closer: () => Promise<void>;

  private constructor(
    collectionFactory: CollectionFactory,
    closer: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.collectionFactory = collectionFactory;
    this.closer = closer;
  }

  static create(uri: string): MongoWrapper {
    const client = new Driver(uri);
    const db = client.db();
    return new MongoWrapper(
      (name: string) => new RealCollection(db.collection(name)),
      () => client.close(),
    );
  }

  static createNull(options: StubbedMongoOptions = {}): MongoWrapper {
    const stub = new StubbedCollectionFactory(options);
    return new MongoWrapper(
      (name: string) => stub.collection(name),
      () => stub.close(),
    );
  }

  // Close the driver connection. Stop every open change stream first: closing the
  // driver client with a change stream still open is the race that logs
  // MongoClientClosedError. Safe to call when nothing ever connected — the driver's
  // own close is a no-op then, and Nulled instances close to nothing.
  async close(): Promise<void> {
    await this.stopAllWatches();
    await this.closer();
    this.emitter.emit(CLOSE_EVENT);
  }

  // Force every active change stream shut, regardless of remaining subscribers.
  // Mirrors closeWatchIfUnused but drains the whole map at once, for shutdown.
  private async stopAllWatches(): Promise<void> {
    const watches = [...this.activeWatches.values()];
    this.activeWatches.clear();
    for (const watch of watches) {
      const stopWatching = await watch;
      await stopWatching();
    }
  }

  async find<T>(collection: string, query: object): Promise<T[]> {
    return this.collectionFactory(collection).find(query);
  }

  async insert(collection: string, doc: object): Promise<void> {
    return this.collectionFactory(collection).insertOne(doc);
  }

  async update(collection: string, query: object, changes: object): Promise<void> {
    return this.collectionFactory(collection).updateMany(query, changes);
  }

  async remove(collection: string, query: object): Promise<void> {
    return this.collectionFactory(collection).deleteMany(query);
  }

  async watchChanges(
    collection: string,
    cb: (data: ChangeEvent) => void,
  ): Promise<() => Promise<void>> {
    const wrappedCb = (data: unknown) => {
      if (isChangeEvent(data)) {
        cb(data);
      }
    };
    this.emitter.on(collection, wrappedCb);
    await this.openWatchIfNeeded(collection);

    return async () => {
      this.emitter.off(collection, wrappedCb);
      await this.closeWatchIfUnused(collection);
    };
  }

  watcherCount(collection: string): number {
    return this.emitter.listenerCount(collection);
  }

  async trackChanges(collection: string): Promise<OutputTracker> {
    const tracker = new OutputTracker(this.emitter, collection);
    await this.openWatchIfNeeded(collection);
    return tracker;
  }

  trackClose(): OutputTracker {
    return new OutputTracker(this.emitter, CLOSE_EVENT);
  }

  private openWatchIfNeeded(collection: string): Promise<() => void> {
    const existing = this.activeWatches.get(collection);
    if (existing) {
      return existing;
    }

    // Store the promise synchronously, before any await, so two subscribers that
    // arrive in the same tick share one change stream rather than opening two.
    const watch = this.collectionFactory(collection).watch((raw) => {
      const changeEvent = mapRawChangeToChangeEvent(raw);
      this.emitter.emit(collection, changeEvent ?? raw);
    });
    this.activeWatches.set(collection, watch);
    return watch;
  }

  private async closeWatchIfUnused(collection: string): Promise<void> {
    if (this.emitter.listenerCount(collection) > 0) {
      return;
    }

    const watch = this.activeWatches.get(collection);
    if (watch) {
      this.activeWatches.delete(collection);
      const stopWatching = await watch;
      await stopWatching();
    }
  }
}

class RealCollection implements CollectionLike {
  constructor(private readonly collection: Collection) {}

  find<T>(query: object): Promise<T[]> {
    return this.collection.find(query).toArray() as Promise<T[]>;
  }

  insertOne(doc: object): Promise<void> {
    return this.collection.insertOne(doc).then(() => undefined);
  }

  updateMany(query: object, changes: object): Promise<void> {
    return this.collection.updateMany(query, changes).then(() => undefined);
  }

  deleteMany(query: object): Promise<void> {
    return this.collection.deleteMany(query).then(() => undefined);
  }

  async watch(onChange: (raw: unknown) => void): Promise<() => Promise<void>> {
    const changeStream = this.collection.watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', onChange);
    changeStream.on('error', (err) => {
      // Log for visibility, but don't rethrow or tear down the stream. The
      // caller still surfaces errors through regular driver behaviour.
      console.error(`Mongo change stream error on ${this.collection.collectionName}`, err);
    });
    // Resolve only once the server side cursor is established. collection.watch()
    // returns before the cursor exists, so a write on the next line would be
    // dropped; resumeTokenChanged fires once the cursor is live.
    await new Promise<void>((resolve, reject) => {
      changeStream.once('resumeTokenChanged', () => {
        resolve();
      });
      changeStream.once('error', reject);
    });
    // Return the close promise so callers can await the stream actually shutting
    // down before the driver client is closed underneath it.
    return () => changeStream.close();
  }
}

class StubbedCollectionFactory {
  private readonly emitter = new EventEmitter();
  private readonly collections = new Map<string, StubbedCollection>();
  private readonly findResponses?: ConfigurableResponse;
  private readonly insertResponses?: ConfigurableResponse;
  private readonly updateResponses?: ConfigurableResponse;
  private readonly removeResponses?: ConfigurableResponse;
  private readonly closeResponses?: ConfigurableResponse;

  constructor(options: StubbedMongoOptions) {
    if (options.find) {
      this.findResponses = new ConfigurableResponse(options.find);
    }
    if (options.insert) {
      this.insertResponses = new ConfigurableResponse(options.insert);
    }
    if (options.update) {
      this.updateResponses = new ConfigurableResponse(options.update);
    }
    if (options.remove) {
      this.removeResponses = new ConfigurableResponse(options.remove);
    }
    if (options.close) {
      this.closeResponses = new ConfigurableResponse(options.close);
    }
  }

  async close(): Promise<void> {
    if (this.closeResponses) {
      this.closeResponses.next();
    }
    return Promise.resolve();
  }

  collection(name: string): CollectionLike {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new StubbedCollection(
        name,
        this.emitter,
        this.findResponses,
        this.insertResponses,
        this.updateResponses,
        this.removeResponses,
      );
      this.collections.set(name, collection);
    }
    return collection;
  }
}

class StubbedCollection implements CollectionLike {
  constructor(
    private readonly collectionName: string,
    private readonly emitter: EventEmitter,
    private readonly findResponses?: ConfigurableResponse,
    private readonly insertResponses?: ConfigurableResponse,
    private readonly updateResponses?: ConfigurableResponse,
    private readonly removeResponses?: ConfigurableResponse,
  ) {}

  find<T>(query: object): Promise<T[]> {
    this.emitter.emit(this.collectionName, {
      type: 'find',
      collection: this.collectionName,
      query,
    });

    if (this.findResponses) {
      return Promise.resolve(this.findResponses.next() as T[]);
    }

    return Promise.resolve([]);
  }

  insertOne(doc: object): Promise<void> {
    if (this.insertResponses) {
      this.insertResponses.next();
    }

    const id = idFrom(doc);
    this.emitter.emit(this.collectionName, {
      type: 'insert',
      collection: this.collectionName,
      id,
      fields: doc as Record<string, unknown>,
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  updateMany(query: object, changes: object): Promise<void> {
    if (this.updateResponses) {
      this.updateResponses.next();
    }

    const setFields = (changes as Record<string, Record<string, unknown>>)['$set'] ?? {};
    this.emitter.emit(this.collectionName, {
      type: 'update',
      collection: this.collectionName,
      id: idFrom(query),
      fields: setFields,
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  deleteMany(query: object): Promise<void> {
    if (this.removeResponses) {
      this.removeResponses.next();
    }

    this.emitter.emit(this.collectionName, {
      type: 'remove',
      collection: this.collectionName,
      id: idFrom(query),
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  watch(onChange: (raw: unknown) => void): Promise<() => Promise<void>> {
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(this.collectionName, listener);
    return Promise.resolve(() => {
      this.emitter.off(this.collectionName, listener);
      return Promise.resolve();
    });
  }
}

function idFrom(source: object): string {
  if ('_id' in source && typeof source._id === 'string') {
    return source._id;
  }
  return new ObjectId().toString();
}

function mapRawChangeToChangeEvent(raw: unknown): ChangeEvent | null {
  if (isChangeEvent(raw)) {
    return raw;
  }

  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const operationType = (raw as { operationType?: unknown }).operationType;
  const collection = (raw as { ns?: { coll?: unknown } }).ns?.coll;
  const documentKey = (raw as { documentKey?: { _id?: unknown } }).documentKey;

  if (operationType === 'insert') {
    const fullDocument = (raw as { fullDocument?: unknown }).fullDocument;
    const id = getId(documentKey?._id);
    return {
      type: 'insert',
      collection: typeof collection === 'string' ? collection : '',
      id,
      fields: extractFields(fullDocument),
    };
  }

  if (operationType === 'update' || operationType === 'replace') {
    const fullDocument = (raw as { fullDocument?: unknown }).fullDocument;
    const updateDescription = (raw as { updateDescription?: unknown }).updateDescription as
      | { updatedFields?: Record<string, unknown> }
      | undefined;
    const id = getId(documentKey?._id);
    return {
      type: 'update',
      collection: typeof collection === 'string' ? collection : '',
      id,
      fields: fullDocument ? extractFields(fullDocument) : (updateDescription?.updatedFields ?? {}),
    };
  }

  if (operationType === 'delete') {
    const id = getId(documentKey?._id);
    return {
      type: 'remove',
      collection: typeof collection === 'string' ? collection : '',
      id,
    };
  }

  return null;
}

function extractFields(fullDocument: unknown): Record<string, unknown> {
  if (typeof fullDocument !== 'object' || fullDocument === null || Array.isArray(fullDocument)) {
    return {};
  }

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fullDocument)) {
    if (key === '_id') {
      continue;
    }
    fields[key] = value;
  }
  return fields;
}

function getId(id: unknown): string {
  if (typeof id === 'string') {
    return id;
  }
  if (
    typeof id === 'object' &&
    id !== null &&
    'toString' in id &&
    typeof (id as { toString: () => string }).toString === 'function'
  ) {
    return (id as { toString: () => string }).toString();
  }

  return '';
}
