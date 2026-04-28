import { MongoWrapper } from '../../../server/infrastructure/mongo.ts';
import { WebSocketWrapper } from '../../../server/infrastructure/websocket.ts';
import type { StubbedClient } from '../../../server/infrastructure/websocket.ts';

type Fix = 'on' | 'off';
type TransitionKind = 'connect' | 'subscribe' | 'disconnect' | 'cleanup';

export interface Transition {
  kind: TransitionKind;
  clientId?: string;
}

export class DisconnectLeakScene {
  private mongo = MongoWrapper.createNull();
  private ws = WebSocketWrapper.createNull();
  private _fix: Fix = 'on';
  private clients = new Map<string, StubbedClient>();
  private clientCleanups = new Map<string, Array<() => void>>();
  private transitionCallbacks: Array<(t: Transition) => void> = [];

  setFix(fix: Fix): void {
    this._fix = fix;
  }

  connectClient(): string {
    const client = this.ws.simulateConnection();
    this.clients.set(client.id, client);

    if (this._fix === 'on') {
      this.ws.onDisconnect((cid) => {
        if (cid !== client.id) return;
        const cleanups = this.clientCleanups.get(cid);
        if (!cleanups || cleanups.length === 0) return;
        for (const fn of cleanups) {
          fn();
        }
        this.clientCleanups.delete(cid);
        this.emit({ kind: 'cleanup', clientId: cid });
      });
    }

    this.emit({ kind: 'connect', clientId: client.id });
    return client.id;
  }

  subscribe(clientId: string, _subId: string, collection: string): void {
    const cleanup = this.mongo.watchChanges(collection, () => {});
    if (this._fix === 'on') {
      const list = this.clientCleanups.get(clientId) ?? [];
      list.push(cleanup);
      this.clientCleanups.set(clientId, list);
    }
    this.emit({ kind: 'subscribe', clientId });
  }

  disconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.emit({ kind: 'disconnect', clientId });
    client.close();
    this.clients.delete(clientId);
  }

  watcherCount(collection: string): number {
    return this.mongo.watcherCount(collection);
  }

  onTransition(cb: (t: Transition) => void): void {
    this.transitionCallbacks.push(cb);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get fix(): Fix {
    return this._fix;
  }

  get clientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  private emit(t: Transition): void {
    for (const cb of this.transitionCallbacks) {
      cb(t);
    }
  }
}
