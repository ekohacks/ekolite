import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

const CHANGE_EVENT = 'change';

interface FileStorageInterface {
  save(name: string, data: Buffer): Promise<void>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  resolve(name: string): string;
  trackChanges(): OutputTracker;
}

export class FileStorageWrapper {
  private fs: FileStorageInterface;

  private constructor(fs: FileStorageInterface) {
    this.fs = fs;
  }

  static create(basePath: string): FileStorageWrapper {
    return new FileStorageWrapper(new RealFileStorage(basePath));
  }

  static createNull(
    options: {
      save?: unknown[];
      exists?: unknown[];
      remove?: unknown[];
    } = {},
  ): FileStorageWrapper {
    return new FileStorageWrapper(new StubbedFileStorage(options));
  }

  async save(name: string, data: Buffer): Promise<void> {
    if (!name) throw new Error('File name cannot be empty');
    return this.fs.save(name, data);
  }

  async exists(name: string): Promise<boolean> {
    return this.fs.exists(name);
  }

  async remove(name: string): Promise<void> {
    return this.fs.remove(name);
  }

  resolve(name: string): string {
    return this.fs.resolve(name);
  }

  trackChanges(): OutputTracker {
    return this.fs.trackChanges();
  }
}

class RealFileStorage implements FileStorageInterface {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async save(name: string, data: Buffer): Promise<void> {
    const fullPath = this.resolve(name);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
  }

  async exists(name: string): Promise<boolean> {
    try {
      await access(this.resolve(name));
      return true;
    } catch {
      return false;
    }
  }

  async remove(name: string): Promise<void> {
    await unlink(this.resolve(name));
  }

  resolve(name: string): string {
    return resolve(this.basePath, name);
  }

  trackChanges(): OutputTracker {
    throw new Error('trackChanges is only available on null instances');
  }
}

interface StubbedFileSystemOptions {
  save?: unknown[];
  exists?: unknown[];
  remove?: unknown[];
}

class StubbedFileStorage implements FileStorageInterface {
  private store = new Map<string, Buffer>();
  private emitter = new EventEmitter();
  private saveResponses?: ConfigurableResponse;
  private existsResponses?: ConfigurableResponse;
  private removeResponses?: ConfigurableResponse;

  constructor(options: StubbedFileSystemOptions = {}) {
    if (options.save) this.saveResponses = new ConfigurableResponse(options.save);
    if (options.exists) this.existsResponses = new ConfigurableResponse(options.exists);
    if (options.remove) this.removeResponses = new ConfigurableResponse(options.remove);
  }

  save(name: string, data: Buffer): Promise<void> {
    this.saveResponses?.next();
    this.store.set(name, data);
    this.emitter.emit(CHANGE_EVENT, {
      type: 'save',
      name,
      data,
    });
    return Promise.resolve();
  }

  exists(name: string): Promise<boolean> {
    this.existsResponses?.next() as boolean;
    const exists = this.store.has(name);
    this.emitter.emit(CHANGE_EVENT, {
      type: 'exists',
      name,
      exists,
    });
    return Promise.resolve(exists);
  }

  remove(name: string): Promise<void> {
    this.removeResponses?.next();
    this.store.delete(name);
    this.emitter.emit(CHANGE_EVENT, {
      type: 'remove',
      name,
    });
    return Promise.resolve();
  }

  resolve(name: string): string {
    return resolve('/tmp/ekolite-null', name);
  }

  trackChanges(): OutputTracker {
    return new OutputTracker(this.emitter, CHANGE_EVENT);
  }
}
