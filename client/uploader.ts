import { EventEmitter, OutputTracker } from '../server/infrastructure/outputTracker.ts';

const REQUEST_EVENT = 'request';

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
    body: UploadResponse;
  };
}

interface RequestLike {
  open(method: string, url: string): void;
  send(body: FormData): void;

  onload: (() => void) | null;
  onerror: (() => void) | null;

  status: number;
  responseText: string;
}

class RealRequest implements RequestLike {
  private readonly xhr = new XMLHttpRequest();

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    this.xhr.onload = () => this.onload?.();
    this.xhr.onerror = () => this.onerror?.();
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

  status: number;
  responseText: string;

  method = '';
  url = '';

  constructor(response: NullUploaderOptions['response']) {
    this.status = response.status;
    this.responseText = JSON.stringify(response.body);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(_body: FormData): void {
    queueMicrotask(() => {
      this.onload?.();
    });
  }
}

export class Uploader {
  private readonly emitter = new EventEmitter();

  private constructor(private readonly request: RequestLike) {}

  static create(): Uploader {
    return new Uploader(new RealRequest());
  }

  static createNull(options: NullUploaderOptions): Uploader {
    return new Uploader(new NullRequest(options.response));
  }

  async upload(file: File): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);

      this.request.open('POST', '/api/files');

      this.request.onload = () => {
        if (this.request.status >= 200 && this.request.status < 300) {
          const parsed: unknown = JSON.parse(this.request.responseText);

          if (!isUploadResponse(parsed)) {
            reject(new Error('Invalid upload response'));
            return;
          }

          resolve(parsed);
        } else {
          reject(new Error(`Upload failed (${String(this.request.status)})`));
        }
      };

      this.request.onerror = () => {
        reject(new Error('Upload failed'));
      };

      this.request.send(form);

      this.emitter.emit(REQUEST_EVENT, {
        method: 'POST',
        url: '/api/files',
      });
    });
  }

  trackRequests(): OutputTracker {
    return new OutputTracker(this.emitter, REQUEST_EVENT);
  }
}
