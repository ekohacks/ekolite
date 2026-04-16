# EkoSlack: Naming consistency cleanup

## Summary

The infrastructure wrappers have inconsistent naming across facades, interfaces, implementations, and one file. This is a slack time task for Ebuka to clean up using vim. All changes are mechanical renames with the test suite as a safety net.

## Acceptance criteria

- [ ] `output_tracker.ts` renamed to `outputTracker.ts` and all imports updated
- [ ] Facade classes all follow the same suffix convention (decide: Wrapper or no Wrapper, apply everywhere)
- [ ] Implementation class names match their facade (e.g. `FileStorage` wraps `RealFileStorage` not `RealFileSystem`)
- [ ] Interface names match their facade (e.g. `FileStorage` has `FileStorageInterface` not `FileSystemInterface`)
- [ ] All tests pass after every rename

## What to rename

### File rename

| Before              | After              |
| ------------------- | ------------------ |
| `output_tracker.ts` | `outputTracker.ts` |

### If we drop the Wrapper suffix (recommended, 3 already don't use it)

| Before             | After                                                    |
| ------------------ | -------------------------------------------------------- |
| `WebSocketWrapper` | `WebSocket` (or keep as is if collision with ws library) |
| `MongoWrapper`     | `Mongo`                                                  |

### If we add the Wrapper suffix everywhere

| Before         | After                 |
| -------------- | --------------------- |
| `FileStorage`  | `FileStorageWrapper`  |
| `ScriptRunner` | `ScriptRunnerWrapper` |
| `ClientSocket` | `ClientSocketWrapper` |

### Implementation and interface alignment

| Facade             | Current interface          | Should be                                 | Current real          | Should be                            |
| ------------------ | -------------------------- | ----------------------------------------- | --------------------- | ------------------------------------ |
| `WebSocketWrapper` | `WebSocketServerInterface` | `WebSocketInterface`                      | `RealWebSocketServer` | `RealWebSocket`                      |
| `MongoWrapper`     | `MongoClientInterface`     | `MongoInterface`                          | `RealMongoClient`     | `RealMongo`                          |
| `FileStorage`      | `FileSystemInterface`      | `FileStorageInterface`                    | `RealFileSystem`      | `RealFileStorage`                    |
| `ScriptRunner`     | `ProcessRunnerInterface`   | `ScriptRunnerInterface`                   | `RealProcessRunner`   | `RealScriptRunner`                   |
| `ClientSocket`     | `ClientSocketInterface`    | `ClientSocketInterface` (already correct) | `RealClientSocket`    | `RealClientSocket` (already correct) |

Same pattern for Stubbed: `StubbedFileSystem` becomes `StubbedFileStorage`, `StubbedProcessRunner` becomes `StubbedScriptRunner`, etc.

## How to do it (vim)

Each rename is a `:%s/OldName/NewName/g` across the relevant files. Open all infrastructure files at once:

```vim
:args server/infrastructure/*.ts client/clientSocket.ts tests/**/*.ts
:argdo %s/RealFileSystem/RealFileStorage/g | update
```

Run `npm test` after each rename to make sure nothing broke.

## Notes

- The interfaces are not exported so renaming them only affects their own file
- The Real/Stubbed classes are also not exported (only the facades are) so most renames are file internal
- `StubbedClient` and `StubbedServer` (test helpers) are exported but their names are fine
- `ConfigurableResponse`, `EventEmitter`, `OutputTracker` names are fine, leave them
- Do one rename at a time, run tests, commit. Do not batch.

## Estimate

Small. One pairing session or a focused afternoon solo.
