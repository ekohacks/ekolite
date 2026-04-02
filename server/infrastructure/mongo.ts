import { MongoClient as Driver, Db, ObjectId } from 'mongodb';
import { EventEmitter, OutputTracker, ConfigurableResponse } from './output_tracker.ts';
import { ChangeEvent } from '../../shared/types.ts';

interface MongoClientInterface {
  find<T>(collection: string, query: object): Promise<T[]>;
  insert(collection: string, doc: object): Promise<void>;
  update(collection: string, query: object, changes: object): Promise<void>;
  remove(collection: string, query: object): Promise<void>;
  trackChanges(collection: string): OutputTracker;
}

export class MongoWrapper {
  private client: MongoClientInterface;

  private constructor(client: MongoClientInterface) {
    this.client = client;
  }

  static create(uri: string): MongoWrapper {
    return new MongoWrapper(new RealMongoClient(uri));
  }

  static createNull(options: { find?: unknown[] } = {}): MongoWrapper {
    return new MongoWrapper(new StubbedMongoClient(options));
  }

  async find<T>(collection: string, query: object): Promise<T[]> {
    return this.client.find<T>(collection, query);
  }

  async insert(collection: string, doc: object): Promise<void> {
    return this.client.insert(collection, doc);
  }

  async update(collection: string, query: object, changes: object): Promise<void> {
    return this.client.update(collection, query, changes);
  }

  async remove(collection: string, query: object): Promise<void> {
    return this.client.remove(collection, query);
  }

  trackChanges(collection: string): OutputTracker {
    return this.client.trackChanges(collection);
  }
}

class RealMongoClient implements MongoClientInterface {
  private db: Db;

  constructor(uri: string) {
    const client = new Driver(uri);
    this.db = client.db();
  }

  async find<T>(collection: string, query: object): Promise<T[]> {
    return (await this.db.collection(collection).find(query).toArray()) as T[];
  }

  async insert(collection: string, doc: object): Promise<void> {
    await this.db.collection(collection).insertOne(doc);
  }

  async update(collection: string, query: object, changes: object): Promise<void> {
    await this.db.collection(collection).updateMany(query, changes);
  }

  async remove(collection: string, query: object): Promise<void> {
    await this.db.collection(collection).deleteMany(query);
  }

  trackChanges(_collection: string): OutputTracker {
    throw new Error('trackChanges is only available on null instances');
  }
}

class StubbedMongoClient implements MongoClientInterface {
  private store = new Map<string, unknown[]>();
  private emitter = new EventEmitter();
  private findResponses?: ConfigurableResponse;

  constructor(options: { find?: unknown[] } = {}) {
    if (options.find) {
      this.findResponses = new ConfigurableResponse(options.find);
    }
  }

  find<T>(collection: string, _query: object): Promise<T[]> {
    if (this.findResponses) {
      const response = this.findResponses.next();
      return Promise.resolve(response as T[]);
    }
    const docs = this.store.get(collection) ?? [];
    return Promise.resolve(docs as T[]);
  }

  insert(collection: string, doc: object): Promise<void> {
    if (!this.store.has(collection)) {
      this.store.set(collection, []);
    }
    const id = new ObjectId().toString();
    this.store.get(collection)?.push(doc);
    this.emitter.emit(collection, {
      type: 'insert',
      collection,
      id,
      fields: doc as Record<string, unknown>,
    } satisfies ChangeEvent);
    return Promise.resolve();
  }

  update(collection: string, query: object, changes: object): Promise<void> {
    const docs = this.store.get(collection) ?? [];
    const queryEntries = Object.entries(query as Record<string, unknown>);
    const setFields = (changes as Record<string, Record<string, unknown>>)['$set'] ?? {};

    for (const doc of docs) {
      const record = doc as Record<string, unknown>;
      const matches = queryEntries.every(([key, value]) => record[key] === value);
      if (matches) {
        Object.assign(record, setFields);
        this.emitter.emit(collection, {
          type: 'update',
          collection,
          id: (record['_id'] as string) || new ObjectId().toString(),
          fields: setFields,
        } satisfies ChangeEvent);
      }
    }
    return Promise.resolve();
  }

  remove(collection: string, query: object): Promise<void> {
    const docs = this.store.get(collection) ?? [];
    const queryEntries = Object.entries(query as Record<string, unknown>);
    const removed: Record<string, unknown>[] = [];
    const kept: unknown[] = [];

    for (const doc of docs) {
      const record = doc as Record<string, unknown>;
      const matches = queryEntries.every(([key, value]) => record[key] === value);
      if (matches) {
        removed.push(record);
      } else {
        kept.push(doc);
      }
    }

    this.store.set(collection, kept);

    for (const record of removed) {
      this.emitter.emit(collection, {
        type: 'remove',
        collection,
        id: (record['_id'] as string) || new ObjectId().toString(),
      } satisfies ChangeEvent);
    }
    return Promise.resolve();
  }

  trackChanges(collection: string): OutputTracker {
    return new OutputTracker(this.emitter, collection);
  }
}
