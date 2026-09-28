/**
 * Shared type definitions used by both server and client.
 */

import { EkoLiteError } from './protocol.ts';

// ── File uploads ────────────────────────────────────────────────────────────

export interface UploadMeta {
  name: string;
  size: number;
  type: string;
  extension: string;
}

export interface StoredFile {
  _id: string;
  name: string;
  path: string;
  size: number;
  extension: string;
  uploadedAt: Date;
  countC?: number;
  meta?: Record<string, unknown>;
}

// ── Script execution ────────────────────────────────────────────────────────

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── Change events (MongoDB wrapper) ─────────────────────────────────────────

export type ChangeEvent =
  | { type: 'insert'; collection: string; id: string; fields: Record<string, unknown> }
  | { type: 'update'; collection: string; id: string; fields: Record<string, unknown> }
  | { type: 'remove'; collection: string; id: string };

export function isChangeEvent(data: unknown): data is ChangeEvent {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  if (!('type' in data) || typeof data.type !== 'string') {
    return false;
  }
  if (!('collection' in data) || typeof data.collection !== 'string') {
    return false;
  }
  if (!('id' in data) || typeof data.id !== 'string') {
    return false;
  }
  if (data.type === 'insert' || data.type === 'update') {
    return !(
      !('fields' in data) ||
      typeof data.fields !== 'object' ||
      data.fields === null ||
      Array.isArray(data.fields)
    );
  }
  return data.type === 'remove';
}

// ── Method definitions ──────────────────────────────────────────────────────

// Who is calling. Carried to the method as `this`, the way Meteor carried `this.userId`,
// so an arrow function that does not care never sees it and a function that does reads
// `this.clientId`. Over the wire it is the socket's client id; a call the server makes on
// its own, from a test or from another method, has no client and gets null.
export interface MethodContext {
  clientId: string | null;
}

export type MethodFn = (this: MethodContext, ...args: unknown[]) => Promise<unknown>;

export const SERVER_CALL: MethodContext = { clientId: null };

export function methodNotFound(name: string): RpcError {
  return new RpcError(404, `Method not found: ${name}`);
}

export class RpcError extends Error implements EkoLiteError {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export function toEkoLiteError(error: unknown): EkoLiteError {
  if (error instanceof RpcError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: 500,
    message: error instanceof Error ? error.message : String(error),
  };
}

// ── File definitions ──────────────────────────────────────────────────────

export function fileUploadError(extension: string): RpcError {
  return new RpcError(400, `Unsupported file type: .${extension}`);
}

export function fileNotFound(id: string): RpcError {
  return new RpcError(404, `File not found: ${id}`);
}
