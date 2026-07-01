import { EventEmitter, OutputTracker } from '../server/infrastructure/outputTracker.ts';
import { EkoLiteError } from '../shared/protocol.ts';
import { RpcError } from '../shared/types.ts';

const REQUEST_EVENT = 'request';

function isUploadError(data: unknown): data is EkoLiteError {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const error = data as Record<string, unknown>;

  return typeof error.code === 'number' && typeof error.message === 'string';
}

interface UploadProgress {
  percent: number;
}

interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
}

interface ProgressEventLike {
  loaded: number;
  total: number;
  lengthComputable?: boolean;
}

interface UploadRequest {
  method: string;
  url: string;
  body: FormData;
}

interface UploadResponse {
  id: string;
  name: string;
}

function isUploadResponse(data: unknown): data is UploadResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const response = data as Record<string, unknown>;

  return typeof response.id === 'string' && typeof response.name === 'string';
}

interface NullUploaderOptions {
  response: {
    status: number;
    body: unknown;
  };

  progress?: {
    loaded: number;
    total: number;
    lengthComputable?: boolean;
  }[];
}

interface RequestLike {
  open(method: string, url: string): void;
  send(body: FormData): void;

  onload: (() => void) | null;
  onerror: (() => void) | null;

  onprogress: ((event: ProgressEventLike) => void) | null;

  status: number;
  responseText: string;
}

type RequestFactory = () => RequestLike;

class RealRequest implements RequestLike {
  private readonly xhr = new XMLHttpRequest();

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  onprogress: ((event: ProgressEventLike) => void) | null = null;

  constructor() {
    this.xhr.onload = () => this.onload?.();
    this.xhr.onerror = () => this.onerror?.();
    this.xhr.upload.onprogress = (event) => {
      this.onprogress?.({
        loaded: event.loaded,
        total: event.total,
        lengthComputable: event.lengthComputable,
      });
    };
  }

  open(method: string, url: string): void {
    this.xhr.open(method, url);
  }

  send(body: FormData): void {
    this.xhr.send(body);
  }

  get status(): number {
    return this.xhr.status;
  }

  get responseText(): string {
    return this.xhr.responseText;
  }
}

class NullRequest implements RequestLike {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onprogress: ((event: ProgressEventLike) => void) | null = null;
  status: number;
  responseText: string;

  method = '';
  url = '';

  constructor(
    response: NullUploaderOptions['response'],
    private readonly progress: NullUploaderOptions['progress'] = [],
  ) {
    this.status = response.status;
    this.responseText = JSON.stringify(response.body);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(_body: FormData): void {
    queueMicrotask(() => {
      if (this.progress) {
        for (const step of this.progress) {
          this.onprogress?.({
            loaded: step.loaded,
            total: step.total,
            lengthComputable: step.lengthComputable ?? true,
          });
        }
      }

      this.onload?.();
    });
  }
}

export class Uploader {
  private readonly emitter = new EventEmitter();

  private constructor(private readonly createRequest: RequestFactory) {}

  static create(): Uploader {
    return new Uploader(() => new RealRequest());
  }

  static createNull(options: NullUploaderOptions): Uploader {
    return new Uploader(() => new NullRequest(options.response, options.progress));
  }

  async upload(file: File, options?: UploadOptions): Promise<UploadResponse> {
    const request = this.buildRequest(file);

    this.emitter.emit(REQUEST_EVENT, {
      method: request.method,
      url: request.url,
      filename: file.name,
    });

    return this.execute(request, options?.onProgress);
  }

  private buildRequest(file: File): UploadRequest {
    const body = new FormData();
    body.append('file', file);

    return {
      method: 'POST',
      url: '/api/files',
      body,
    };
  }

  private resolveUpload(request: RequestLike): UploadResponse {
    const parsed: unknown = JSON.parse(request.responseText);

    if (request.status >= 200 && request.status < 300) {
      if (!isUploadResponse(parsed)) {
        throw new Error('Invalid upload response');
      }

      return parsed;
    }

    if (!isUploadError(parsed)) {
      throw new Error('Invalid upload error');
    }

    throw new RpcError(parsed.code, parsed.message);
  }

  private execute(
    upload: UploadRequest,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<UploadResponse> {
    const request = this.createRequest();

    return new Promise((resolve, reject) => {
      request.open(upload.method, upload.url);

      request.onprogress = (event) => {
        onProgress?.(this.normalizeProgress(event));
      };

      request.onload = () => {
        try {
          resolve(this.resolveUpload(request));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      request.onerror = () => {
        reject(new Error('Upload failed'));
      };

      request.send(upload.body);
    });
  }

  private normalizeProgress(event: ProgressEventLike): UploadProgress {
    if (!event.lengthComputable || event.total === 0) {
      return { percent: 0 };
    }

    return {
      percent: Math.round((event.loaded / event.total) * 100),
    };
  }

  trackRequests(): OutputTracker {
    return new OutputTracker(this.emitter, REQUEST_EVENT);
  }
}
