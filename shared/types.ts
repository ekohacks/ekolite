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

export interface ChangeEvent {
  type: "insert" | "update" | "remove";
  collection: string;
  id: string;
  fields?: Record<string, unknown>;
}

// ── Method definitions ──────────────────────────────────────────────────────

export type MethodFn = (...args: any[]) => Promise<unknown>;
