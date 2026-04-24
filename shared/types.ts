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
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data.type === 'insert' || data.type === 'update' || data.type === 'remove')
  );
}

// ── Method definitions ──────────────────────────────────────────────────────

export type MethodFn = (...args: unknown[]) => Promise<unknown>;
