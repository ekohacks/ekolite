import { EventEmitter } from '../../../server/infrastructure/outputTracker.ts';

type Mode = 'closure' | 'direct';
type TransitionKind = 'subscribe' | 'trigger' | 'cleanup' | 'leakedCleanup';

export interface Transition {
  kind: TransitionKind;
  channel?: string;
}

export class ClosureCaptureScene {
  private emitter = new EventEmitter();
  private _mode: Mode = 'closure';
  private channels = new Set<string>();
  private transitionCallbacks: Array<(t: Transition) => void> = [];

  setMode(mode: Mode): void {
    this._mode = mode;
  }

  reset(): void {
    this.emitter = new EventEmitter();
    this.channels.clear();
  }

  subscribe(channel: string, cb: (data: unknown) => void): () => void {
    const listener = (data: unknown): void => {
      cb(data);
    };
    this.emitter.on(channel, listener);
    this.channels.add(channel);
    const modeAtSubscribe = this._mode;
    this.emit({ kind: 'subscribe', channel });

    return (): void => {
      const before = this.emitter.listenerCount(channel);
      if (modeAtSubscribe === 'closure') {
        this.emitter.off(channel, listener);
      } else {
        this.emitter.off(channel, cb);
      }
      const after = this.emitter.listenerCount(channel);
      if (after < before) {
        this.emit({ kind: 'cleanup', channel });
      } else {
        this.emit({ kind: 'leakedCleanup', channel });
      }
    };
  }

  trigger(channel: string): void {
    this.emitter.emit(channel, { type: 'change', channel });
    this.emit({ kind: 'trigger', channel });
  }

  listenerCount(channel: string): number {
    return this.emitter.listenerCount(channel);
  }

  onTransition(cb: (t: Transition) => void): void {
    this.transitionCallbacks.push(cb);
  }

  get subscriptionCount(): number {
    let total = 0;
    for (const channel of this.channels) {
      total += this.emitter.listenerCount(channel);
    }
    return total;
  }

  get mode(): Mode {
    return this._mode;
  }

  private emit(t: Transition): void {
    for (const cb of this.transitionCallbacks) {
      cb(t);
    }
  }
}
