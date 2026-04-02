import { writeFile, access, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

interface FileSystemInterface {
  save(name: string, data: Buffer): Promise<void>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  resolve(name: string): string;
}

export class FileStorage {
  private fs: FileSystemInterface;

  private constructor(fs: FileSystemInterface) {
    this.fs = fs;
  }

  static create(basePath: string): FileStorage {
    return new FileStorage(new RealFileSystem(basePath));
  }

  static createNull(): FileStorage {
    return new FileStorage(new StubbedFileSystem());
  }

  async save(name: string, data: Buffer): Promise<void> {
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

class RealFileSystem implements FileSystemInterface {
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

class StubbedFileSystem implements FileSystemInterface {
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
