import { Collection, MongoClient as Driver, ObjectId } from 'mongodb';
import { ChangeEvent, isChangeEvent } from '../../shared/types.ts';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

interface CollectionLike {
  find<T>(query: object): Promise<T[]>;
  insertOne(doc: object): Promise<void>;
  updateMany(query: object, changes: object): Promise<void>;
  deleteMany(query: object): Promise<void>;
  watch(onChange: (raw: unknown) => void): () => void;
}

type CollectionFactory = (name: string) => CollectionLike;

interface StubbedMongoOptions {
  find?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  remove?: unknown[];
}

export class MongoWrapper {
  private readonly collectionFactory: CollectionFactory;
  private readonly emitter = new EventEmitter();
  private readonly activeWatches = new Map<string, () => void>();

  private constructor(collectionFactory: CollectionFactory) {
    this.collectionFactory = collectionFactory;
  }

  static create(uri: string): MongoWrapper {
    const client = new Driver(uri);
    const db = client.db();
    return new MongoWrapper((name: string) => new RealCollection(db.collection(name)));
  }

  static createNull(options: StubbedMongoOptions = {}): MongoWrapper {
    const stub = new StubbedCollectionFactory(options);
    return new MongoWrapper((name: string) => stub.collection(name));
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

  watchChanges(collection: string, cb: (data: ChangeEvent) => void): () => void {
    const wrappedCb = (data: unknown) => {
      if (isChangeEvent(data)) {
        cb(data);
      }
    };
    this.emitter.on(collection, wrappedCb);
    this.openWatchIfNeeded(collection);

    return () => {
      this.emitter.off(collection, wrappedCb);
      this.closeWatchIfUnused(collection);
    };
  }

  watcherCount(collection: string): number {
    return this.emitter.listenerCount(collection);
  }

  trackChanges(collection: string): OutputTracker {
    const tracker = new OutputTracker(this.emitter, collection);
    this.openWatchIfNeeded(collection);
    return tracker;
  }

  private openWatchIfNeeded(collection: string): void {
    if (this.activeWatches.has(collection)) {
      return;
    }

    const stopWatching = this.collectionFactory(collection).watch((raw) => {
      const changeEvent = mapRawChangeToChangeEvent(raw);
      if (changeEvent) {
        this.emitter.emit(collection, changeEvent);
      } else {
        this.emitter.emit(collection, raw);
      }
    });

    this.activeWatches.set(collection, stopWatching);
  }

  private closeWatchIfUnused(collection: string): void {
    if (this.emitter.listenerCount(collection) > 0) {
      return;
    }

    const stopWatching = this.activeWatches.get(collection);
    if (stopWatching) {
      stopWatching();
      this.activeWatches.delete(collection);
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

  watch(onChange: (raw: unknown) => void): () => void {
    const changeStream = this.collection.watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', onChange);
    changeStream.on('error', (err) => {
      // Ignore stream errors here. The caller can still report errors through regular driver behavior.
      console.error(`Mongo change stream error on ${this.collection.collectionName}`, err);
    });
    return () => {
      void changeStream.close();
    };
  }
}

class StubbedCollectionFactory {
  private readonly emitter = new EventEmitter();
  private readonly collections = new Map<string, StubbedCollection>();
  private readonly findResponses?: ConfigurableResponse;
  private readonly insertResponses?: ConfigurableResponse;
  private readonly updateResponses?: ConfigurableResponse;
  private readonly removeResponses?: ConfigurableResponse;

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

    const id = new ObjectId().toString();
    this.emitter.emit(this.collectionName, {
      type: 'insert',
      collection: this.collectionName,
      id,
      fields: doc as Record<string, unknown>,
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  updateMany(_query: object, changes: object): Promise<void> {
    if (this.updateResponses) {
      this.updateResponses.next();
    }

    const setFields = (changes as Record<string, Record<string, unknown>>)['$set'] ?? {};
    this.emitter.emit(this.collectionName, {
      type: 'update',
      collection: this.collectionName,
      id: new ObjectId().toString(),
      fields: setFields,
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  deleteMany(_query: object): Promise<void> {
    if (this.removeResponses) {
      this.removeResponses.next();
    }

    this.emitter.emit(this.collectionName, {
      type: 'remove',
      collection: this.collectionName,
      id: new ObjectId().toString(),
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  watch(onChange: (raw: unknown) => void): () => void {
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(this.collectionName, listener);
    return () => {
      this.emitter.off(this.collectionName, listener);
    };
  }
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
    const id = getId(documentKey?._id ?? (fullDocument as { _id?: unknown })._id);
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
    const id = getId(documentKey?._id ?? (fullDocument as { _id?: unknown })._id);
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
