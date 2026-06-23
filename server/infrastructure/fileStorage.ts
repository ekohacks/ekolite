import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve as pathResolve } from 'node:path';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

const CHANGE_EVENT = 'change';

interface FileSystemLike {
  writeFile(path: string, data: Buffer): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  access(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  resolve(name: string): string;
  watch(onChange: (raw: unknown) => void): () => void;
}

interface StubbedFileSystemOptions {
  save?: Error[];
  exists?: Error[];
  remove?: Error[];
}

export class FileStorageWrapper {
  private readonly adapter: FileSystemLike;
  private readonly emitter = new EventEmitter();
  private stopWatch?: (() => void) | undefined;

  private constructor(adapter: FileSystemLike) {
    this.adapter = adapter;
  }

  static create(basePath: string): FileStorageWrapper {
    return new FileStorageWrapper(new RealFileSystem(basePath));
  }

  static createNull(options: StubbedFileSystemOptions = {}): FileStorageWrapper {
    const stubbedFileSystem = new StubbedFileStorage(options);
    return new FileStorageWrapper(stubbedFileSystem);
  }

  async save(name: string, data: Buffer): Promise<void> {
    if (!name) {
      throw new Error('File name cannot be empty');
    }
    await this.adapter.writeFile(name, data);
  }

  async exists(name: string): Promise<boolean> {
    return this.adapter.access(name);
  }

  async remove(name: string): Promise<void> {
    return this.adapter.unlink(name);
  }

  async read(name: string): Promise<Buffer> {
    return this.adapter.readFile(name);
  }

  resolve(name: string): string {
    return this.adapter.resolve(name);
  }

  trackChanges(): OutputTracker {
    this.openWatchIfNeeded();
    return new OutputTracker(this.emitter, CHANGE_EVENT);
  }

  watch(onChange: (raw: unknown) => void): () => void {
    this.openWatchIfNeeded();
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(CHANGE_EVENT, listener);
    return () => {
      this.emitter.off(CHANGE_EVENT, listener);
    };
  }

  private openWatchIfNeeded(): void {
    if (this.stopWatch) {
      return;
    }
    this.stopWatch = this.adapter.watch((raw) => {
      this.emitter.emit(CHANGE_EVENT, raw);
      this.closeWatchIfUnused();
    });
  }

  private closeWatchIfUnused(): void {
    if (this.emitter.listenerCount(CHANGE_EVENT) > 0) {
      return;
    }
    this.stopWatch?.();
    this.stopWatch = undefined;
  }
}

class RealFileSystem implements FileSystemLike {
  private readonly basePath: string;
  private readonly emitter = new EventEmitter();

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async writeFile(name: string, data: Buffer): Promise<void> {
    const fullPath = this.resolve(name);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    this.emitter.emit(CHANGE_EVENT, { type: 'save', name, data });
  }

  async readFile(name: string): Promise<Buffer> {
    return readFile(this.resolve(name));
  }

  async access(name: string): Promise<boolean> {
    try {
      await access(this.resolve(name));
      this.emitter.emit(CHANGE_EVENT, { type: 'exists', name, exists: true });
      return true;
    } catch {
      this.emitter.emit(CHANGE_EVENT, { type: 'exists', name, exists: false });
      return false;
    }
  }

  async unlink(name: string): Promise<void> {
    await unlink(this.resolve(name));
    this.emitter.emit(CHANGE_EVENT, { type: 'remove', name });
  }

  resolve(name: string): string {
    return pathResolve(this.basePath, name);
  }

  watch(onChange: (raw: unknown) => void): () => void {
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(CHANGE_EVENT, listener);
    return () => {
      this.emitter.off(CHANGE_EVENT, listener);
    };
  }
}

class StubbedFileStorage implements FileSystemLike {
  private readonly store = new Map<string, Buffer>();
  private readonly emitter = new EventEmitter();
  private saveResponses?: ConfigurableResponse;
  private existsResponses?: ConfigurableResponse;
  private removeResponses?: ConfigurableResponse;

  constructor(options: StubbedFileSystemOptions = {}) {
    if (options.save) {
      this.saveResponses = new ConfigurableResponse(options.save);
    }
    if (options.exists) {
      this.existsResponses = new ConfigurableResponse(options.exists);
    }
    if (options.remove) {
      this.removeResponses = new ConfigurableResponse(options.remove);
    }
  }

  // Key the store by the resolved path, exactly as the real adapter keys the real
  // file system, so names that resolve to the same path ('a.bam' and './a.bam')
  // are one file in the null and in reality. The event carries the raw name, which
  // is what the real adapter emits.
  writeFile(name: string, data: Buffer): Promise<void> {
    this.saveResponses?.next();
    this.store.set(this.resolve(name), data);
    this.emitter.emit(CHANGE_EVENT, { type: 'save', name, data });
    return Promise.resolve();
  }

  readFile(name: string): Promise<Buffer> {
    const data = this.store.get(this.resolve(name));
    if (!data) {
      return Promise.reject(new Error(`No such file: ${name}`));
    }
    return Promise.resolve(data);
  }

  access(name: string): Promise<boolean> {
    this.existsResponses?.next();
    const exists = this.store.has(this.resolve(name));
    this.emitter.emit(CHANGE_EVENT, { type: 'exists', name, exists });
    return Promise.resolve(exists);
  }

  unlink(name: string): Promise<void> {
    this.removeResponses?.next();
    this.store.delete(this.resolve(name));
    this.emitter.emit(CHANGE_EVENT, { type: 'remove', name });
    return Promise.resolve();
  }

  resolve(name: string): string {
    return pathResolve('/tmp/ekolite-null', name);
  }

  watch(onChange: (raw: unknown) => void): () => void {
    const listener = (data: unknown) => {
      onChange(data);
    };
    this.emitter.on(CHANGE_EVENT, listener);
    return () => {
      this.emitter.off(CHANGE_EVENT, listener);
    };
  }
}
