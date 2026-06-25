import { extname } from 'node:path';
import { MongoWrapper } from '../infrastructure/mongo.ts';
import { FileStorageWrapper } from '../infrastructure/fileStorage.ts';
import { fileUploadError, StoredFile } from '../../shared/types.ts';

export interface UploadInput {
  name: string;
  type: string;
  data: Buffer;
}

interface FilesOptions {
  allowedExtensions?: string[];
}

function extensionOf(name: string) {
  return extname(name).replace(/^\./, '').toLowerCase();
}

// The document recorded for an uploaded file. Pulled out so `upload` reads as
// save, build, insert, with the field-by-field shape in one named place.
function buildStoredFile(input: UploadInput, path: string): StoredFile {
  return {
    _id: globalThis.crypto.randomUUID(),
    name: input.name,
    path,
    size: input.data.length,
    extension: extensionOf(input.name),
    uploadedAt: new Date(),
  };
}

const ALLOWED_EXTENSIONS = ['bam'];

// Files sits over the two infrastructure wrappers the way Publications sits over
// Mongo and the websocket: the route stays thin and the logic is testable on
// nullables. Upload writes the bytes, then records a document describing them so
// the same document streams to subscribers through publications.
export class Files {
  private readonly allowedExtensions: string[];

  constructor(
    private readonly mongo: MongoWrapper,
    private readonly storage: FileStorageWrapper,
    options?: FilesOptions,
  ) {
    this.allowedExtensions = options?.allowedExtensions ?? ALLOWED_EXTENSIONS;
  }

  async upload(input: UploadInput): Promise<StoredFile> {
    const extension = extensionOf(input.name);
    if (!this.isAllowed(extension)) {
      throw fileUploadError(extension);
    }

    await this.storage.save(input.name, input.data);

    const stored = buildStoredFile(input, this.storage.resolve(input.name));

    await this.mongo.insert('files', stored);
    return stored;
  }

  async read(id: string): Promise<{ file: StoredFile; data: Buffer } | null> {
    const docs = await this.mongo.find<StoredFile>('files', { _id: id });
    if (docs.length === 0) {
      return null;
    }
    const file = docs[0];
    const data = await this.storage.read(file.name);
    return { file, data };
  }

  validate(name: string): boolean {
    return this.isAllowed(extensionOf(name));
  }

  private isAllowed(extension: string): boolean {
    return this.allowedExtensions.includes(extension);
  }
}
