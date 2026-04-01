import { MongoClient as Driver, Db } from 'mongodb';

interface MongoClientInterface {
  find<T>(collection: string, query: object): Promise<T[]>;
  insert(collection: string, doc: object): Promise<void>;
  remove(collection: string, query: object): Promise<void>;
}

export class MongoWrapper {
  private client: MongoClientInterface;

  private constructor(client: MongoClientInterface) {
    this.client = client;
  }

  static create(uri: string): MongoWrapper {
    return new MongoWrapper(new RealMongoClientInterface(uri));
  }

  static createNull(docs: Record<string, unknown[]> = {}): MongoWrapper {
    return new MongoWrapper(new StubbedMongoClientInterface(docs));
  }

  async find<T>(collection: string, query: object): Promise<T[]> {
    return this.client.find<T>(collection, query);
  }

  async insert(collection: string, doc: object): Promise<void> {
    return this.client.insert(collection, doc);
  }

  async remove(collection: string, query: object): Promise<void> {
    return this.client.remove(collection, query);
  }
}

class RealMongoClientInterface implements MongoClientInterface {
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

  async remove(collection: string, query: object): Promise<void> {
    await this.db.collection(collection).deleteMany(query);
  }
}

class StubbedMongoClientInterface implements MongoClientInterface {
  private store: Map<string, unknown[]>;

  constructor(initialDocs: Record<string, unknown[]>) {
    this.store = new Map(Object.entries(initialDocs));
  }

  find<T>(collection: string, _query: object): Promise<T[]> {
    const docs = this.store.get(collection) || [];
    return Promise.resolve(docs as T[]);
  }

  insert(collection: string, doc: object): Promise<void> {
    if (!this.store.has(collection)) {
      this.store.set(collection, []);
    }
    this.store.get(collection)?.push(doc);
    return Promise.resolve();
  }

  remove(collection: string, _query: object): Promise<void> {
    this.store.set(collection, []);
    return Promise.resolve();
  }
}
