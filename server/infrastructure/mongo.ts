import { Db, MongoClient as Driver, ObjectId } from 'mongodb';
import { ChangeEvent } from '../../shared/types.ts';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './output_tracker.ts';

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

  static createNull(
    options: {
      find?: unknown[];
      insert?: unknown[];
      update?: unknown[];
      remove?: unknown[];
    } = {},
  ): MongoWrapper {
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

interface StubbedMongoOptions {
  find?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  remove?: unknown[];
}

class StubbedMongoClient implements MongoClientInterface {
  private emitter = new EventEmitter();
  private findResponses?: ConfigurableResponse;
  private insertResponses?: ConfigurableResponse;
  private updateResponses?: ConfigurableResponse;
  private removeResponses?: ConfigurableResponse;

  constructor(options: StubbedMongoOptions = {}) {
    if (options.find) this.findResponses = new ConfigurableResponse(options.find);
    if (options.insert) this.insertResponses = new ConfigurableResponse(options.insert);
    if (options.update) this.updateResponses = new ConfigurableResponse(options.update);
    if (options.remove) this.removeResponses = new ConfigurableResponse(options.remove);
  }

  find<T>(_collection: string, _query: object): Promise<T[]> {
    this.emitter.emit(_collection, {
      type: 'find',
      collection: _collection,
      query: _query,
    });

    if (this.findResponses) {
      const response = this.findResponses.next();
      return Promise.resolve(response as T[]);
    }

    return Promise.resolve([] as T[]);
  }

  insert(collection: string, doc: object): Promise<void> {
    if (this.insertResponses) {
      this.insertResponses.next();
    }

    const id = new ObjectId().toString();
    this.emitter.emit(collection, {
      type: 'insert',
      collection,
      id,
      fields: doc as Record<string, unknown>,
    } satisfies ChangeEvent);

    return Promise.resolve();
  }

  update(collection: string, _query: object, changes: object): Promise<void> {
    if (this.updateResponses) {
      this.updateResponses.next();
    }
    const setFields = (changes as Record<string, Record<string, unknown>>)['$set'] ?? {};
    this.emitter.emit(collection, {
      type: 'update',
      collection,
      id: new ObjectId().toString(),
      fields: setFields,
    } satisfies ChangeEvent);
    return Promise.resolve();
  }

  remove(collection: string, _query: object): Promise<void> {
    if (this.removeResponses) {
      this.removeResponses.next();
    }
    this.emitter.emit(collection, {
      type: 'remove',
      collection,
      id: new ObjectId().toString(),
    } satisfies ChangeEvent);
    return Promise.resolve();
  }

  trackChanges(collection: string): OutputTracker {
    return new OutputTracker(this.emitter, collection);
  }
}
