import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve as pathResolve } from 'node:path';
import { ConfigurableResponse, EventEmitter, OutputTracker } from './outputTracker.ts';

const CHANGE_EVENT = 'change';

interface FileSystemLike {
  writeFile(path: string, data: Buffer): Promise<void>;
  access(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  resolve(name: string): string;
  watch(onChange: (raw: unknown) => void): () => void;
}

interface StubbedFileSystemOptions {
  save?: unknown[];
  exists?: unknown[];
  remove?: unknown[];
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
  private store = new Map<string, Buffer>();
  private emitter = new EventEmitter();
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

  async writeFile(name: string, data: Buffer): Promise<void> {
    this.saveResponses?.next();
    this.store.set(name, data);
    this.emitter.emit(CHANGE_EVENT, { type: 'save', name, data });
    return Promise.resolve();
  }

  async access(name: string): Promise<boolean> {
    this.existsResponses?.next();
    const exists = this.store.has(name);
    this.emitter.emit(CHANGE_EVENT, { type: 'exists', name, exists });
    return Promise.resolve(exists);
  }

  async unlink(name: string): Promise<void> {
    this.removeResponses?.next();
    this.store.delete(name);
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
