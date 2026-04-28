/**
 * Shared type definitions used by both server and client.
 */

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
  if (typeof data !== 'object' || data === null) return false;
  if (!('type' in data) || !('collection' in data) || !('id' in data)) return false;
  if (typeof (data as { collection: unknown }).collection !== 'string') return false;
  if (typeof (data as { id: unknown }).id !== 'string') return false;

  const type = (data as { type: unknown }).type;
  if (type === 'insert' || type === 'update') {
    if (!('fields' in data)) return false;
    const fields = (data as { fields: unknown }).fields;
    return typeof fields === 'object' && fields !== null && !Array.isArray(fields);
  }
  return type === 'remove';
}

// ── Method definitions ──────────────────────────────────────────────────────

export type MethodFn = (...args: unknown[]) => Promise<unknown>;
