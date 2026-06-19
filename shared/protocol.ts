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

export interface PingMsg {
  type: 'ping';
  id?: string;
}

export type ClientMessage = SubscribeMsg | UnsubscribeMsg | MethodMsg | PingMsg;

// ── Server → Client ─────────────────────────────────────────────────────────

export interface ReadyMsg {
  type: 'ready';
  id: string;
  // The collection this subscription owns, decided by the server. The client
  // binds the subscription to it on ready; required so a ready can never arrive
  // without one.
  collection: string;
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

export type ObserverOutcome = 'applied' | 'skipped' | 'failed';

export interface ReactiveStoreObserver {
  onMessage(msg: DataMsg, outcome: ObserverOutcome, reason?: ReactiveStoreReasons): void;
}

export interface PublicationsObserver {
  onMessage(msg: ClientMessage, outcome: ObserverOutcome, reason?: PublicationsReasons): void;
}

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

type ReactiveStoreSkipReason = 'unknown-id';
type ReactiveStoreFailReason = 'unsupported-message-type';
type PublicationsSkipReason = 'unknown-sub-id';
type PublicationsFailReason = 'unknown-publication';
type PublicationsDuplicateSubIdReason = 'duplicate-sub-id';
type PublicationsQueryFailedReason = 'publication-query-failed';
type PublicationsInvalidParamsReason = 'invalid-params';
type PublicationsMongoFailedReason = 'publications-mongo-find-failed';

export type ReactiveStoreReasons =
  /** Document with the given ID is unknown to the store.
   * This can happen when a changed or removed message is received for an id that has not been added. */
  | ReactiveStoreSkipReason
  /** Message type is not supported by the store. */
  | ReactiveStoreFailReason;
export type PublicationsReasons =
  /** Unsubscribe arrived for a sub id this client doesn't have.
   *  Usually a client bug or a race between client and server. */
  | PublicationsSkipReason
  /** Subscribe arrived for a publication name that wasn't defined
   *  on the server. Client and server schemas are out of sync. */
  | PublicationsFailReason
  /** Subscribe arrived with an id that already has a watcher on this
   *  client. Old watcher torn down, new one installed. Applied,
   *  not failed. */
  | PublicationsDuplicateSubIdReason
  /** Publication query function threw while building the subscription. */
  | PublicationsQueryFailedReason
  /** Subscribe params were rejected by the engine (e.g. contained mongo operators). */
  | PublicationsInvalidParamsReason
  /**Publication threw when trying to find in Mongo */
  | PublicationsMongoFailedReason;
