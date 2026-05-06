/**
 * Mini-DDP protocol — 6 message types.
 *
 * Client → Server: subscribe, unsubscribe, method
 * Server → Client: ready, data (added/changed/removed), result/error
 */

// ── Client → Server ─────────────────────────────────────────────────────────

export interface SubscribeMsg {
  type: 'subscribe';
  id: string;
  name: string;
  params?: Record<string, unknown>;
}

export interface UnsubscribeMsg {
  type: 'unsubscribe';
  id: string;
}

export interface MethodMsg {
  type: 'method';
  id: string;
  name: string;
  params: unknown[];
}

export type ClientMessage = SubscribeMsg | UnsubscribeMsg | MethodMsg;

// ── Server → Client ─────────────────────────────────────────────────────────

export interface ReadyMsg {
  type: 'ready';
  id: string;
}

export type DataMsg =
  | {
      type: 'added';
      collection: string;
      id: string;
      fields?: Record<string, unknown>;
    }
  | {
      type: 'changed';
      collection: string;
      id: string;
      fields?: Record<string, unknown>;
    }
  | {
      type: 'removed';
      collection: string;
      id: string;
    };

export interface ResultMsg {
  type: 'result';
  id: string;
  result: unknown;
}

export interface ErrorMsg {
  type: 'error';
  id: string;
  error: EkoLiteError;
}

export type ServerMessage = ReadyMsg | DataMsg | ResultMsg | ErrorMsg;

// ── Shared ──────────────────────────────────────────────────────────────────

export interface EkoLiteError {
  code: number;
  message: string;
  details?: unknown;
}

export type ObserverOutcome = 'applied' | 'skipped' | 'failed';

export interface ReactiveStoreObserver {
  onMessage(msg: DataMsg | ClientMessage, outcome: ObserverOutcome, reason?: string): void;
}
