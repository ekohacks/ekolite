import { writeFile, access, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

interface FileStorageInterface {
  save(name: string, data: Buffer): Promise<void>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  resolve(name: string): string;
}

export class FileStorageWrapper {
  private fs: FileStorageInterface;

  private constructor(fs: FileStorageInterface) {
    this.fs = fs;
  }

  static create(basePath: string): FileStorageWrapper {
    return new FileStorageWrapper(new RealFileStorage(basePath));
  }

  static createNull(): FileStorageWrapper {
    return new FileStorageWrapper(new StubbedFileSystem());
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
}

class StubbedFileSystem implements FileStorageInterface {
  private store = new Map<string, Buffer>();

  save(name: string, data: Buffer): Promise<void> {
    this.store.set(name, data);
    return Promise.resolve();
  }

  exists(name: string): Promise<boolean> {
    return Promise.resolve(this.store.has(name));
  }

  remove(name: string): Promise<void> {
    this.store.delete(name);
    return Promise.resolve();
  }

  resolve(name: string): string {
    return resolve('/tmp/ekolite-null', name);
  }
}
