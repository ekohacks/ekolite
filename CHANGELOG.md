# Changelog

All notable changes to `ekolite` are recorded here. The project is pre-1.0, so a minor version may carry a breaking change.

## 0.3.0

### Added

- **`ekolite run`.** Boot your own app from an `ekolite.config.ts`, with no `start.ts` to copy. Define your publications and methods in a `(eko) => void` app entry, and the runner assembles `App`, applies them, serves your built client, and arms graceful shutdown. Adds the `ekolite` bin (`ekolite run`) and an `ekolite/config` export (`defineConfig`, plus the `AppEntry` and `AppContext` types). TypeScript entries load through Node 24's native type stripping, so there is no build step and no new dependency. A consumer project must set `"type": "module"`. (#146)

## 0.2.0

### Added

- **Client auto-reconnect.** A socket that drops reopens on its own: instant first retry, then a wait that doubles from 1 second to a 30 second cap with jitter, and it never gives up. `reconnect: false` opts out. (#140)
- **Heartbeat on by default.** The live client sends a `ping` every 15 seconds and closes a socket that does not `pong` within 10 seconds, so a silently dead connection is detected. Set either knob to zero to disable it. (#140)
- **Resubscribe and catch up.** On reconnect, subscriptions replay with their original ids and the store swaps its contents whole on the `ready`, so the page keeps its stale view and never renders empty. (#140)
- **`ClientSocketWrapper.status`** (`connecting | connected | reconnecting | closed`), the surface a page renders during an outage. (#140)
- **`App.armShutdown()`.** Consumers can arm graceful shutdown, on a signal or a supervisor's stop message, without reaching into the package internals. (#137)
- **`createServer({ staticRoot })`.** Serve your own built client from any directory. An absent root serves nothing rather than a server that looks healthy and 404s every static request. (#134)

### Changed

- **`App.create` is a clean framework surface.** It no longer defines EkoLite's own demo publications and methods (`files.all`, `echo`, `runCountC`), and `AppConfig` no longer carries `countCScript`. Define your own publications and methods on the empty registries `App.create` returns. This is a breaking change for anyone who relied on the built-in demo. (#133)

### Fixed

- **Shutdown drains change streams before closing Mongo,** so a clean shutdown no longer logs `MongoClientClosedError`. (#113)
- **Graceful shutdown works for a supervisor on Windows** via a stop message, not only an interactive Ctrl+C. (#125)

## 0.1.0

- First published release: the pub/sub engine over a live socket, the method registry and RPC, file upload over HTTP, the reactive client store, `App` wiring, and the npm package with a three-entry export map (`ekolite`, `ekolite/client`, `ekolite/shared`). (#119)
