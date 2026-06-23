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

export type MethodFn = (...args: unknown[]) => Promise<unknown>;

export function methodNotFound(name: string): RpcError {
  return new RpcError(404, `Method not found: ${name}`);
}

class RpcError extends Error implements EkoLiteError {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}
