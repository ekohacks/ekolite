# Naming Inconsistencies

Things to clean up before they become habits. None of these are bugs but they make the codebase harder to navigate when you are new to it.

## 1. "Wrapper" suffix is inconsistent

Two facade classes say Wrapper, three do not.

| Class              | Convention |
| ------------------ | ---------- |
| `WebSocketWrapper` | Wrapper    |
| `MongoWrapper`     | Wrapper    |
| `FileStorage`      | No suffix  |
| `ScriptRunner`     | No suffix  |
| `ClientSocket`     | No suffix  |

Pick one and apply it everywhere. Either everything is a Wrapper (`FileStorageWrapper`, `ScriptRunnerWrapper`, `ClientSocketWrapper`) or nothing is (`WebSocket`, `Mongo`, `FileStorage`, `ScriptRunner`, `ClientSocket`).

## 2. File naming: snake_case vs camelCase

Every infrastructure file uses camelCase except one.

| File                | Convention |
| ------------------- | ---------- |
| `websocket.ts`      | camelCase  |
| `mongo.ts`          | camelCase  |
| `fileStorage.ts`    | camelCase  |
| `scriptRunner.ts`   | camelCase  |
| `clientSocket.ts`   | camelCase  |
| `output_tracker.ts` | snake_case |

`output_tracker.ts` should be `outputTracker.ts`.

## 3. Interface naming: the second word varies

The interfaces all end in `Interface` but the middle concept is different every time.

| Interface                  | Second word |
| -------------------------- | ----------- |
| `WebSocketServerInterface` | Server      |
| `MongoClientInterface`     | Client      |
| `FileSystemInterface`      | System      |
| `ProcessRunnerInterface`   | Runner      |
| `ClientSocketInterface`    | Socket      |

This is not a blocking issue but it means you cannot predict the interface name from the facade name. If you know `FileStorage` exists, you might guess `FileStorageInterface` but it is actually `FileSystemInterface`.

## 4. Implementation class naming vs facade naming

The Real/Stubbed implementations do not always match the facade name.

| Facade             | Real implementation   | Match?                 |
| ------------------ | --------------------- | ---------------------- |
| `WebSocketWrapper` | `RealWebSocketServer` | No (Wrapper vs Server) |
| `MongoWrapper`     | `RealMongoClient`     | No (Wrapper vs Client) |
| `FileStorage`      | `RealFileSystem`      | No (Storage vs System) |
| `ScriptRunner`     | `RealProcessRunner`   | No (Script vs Process) |
| `ClientSocket`     | `RealClientSocket`    | Yes                    |

`ClientSocket` / `RealClientSocket` is the only one where the names line up. Everywhere else the facade and the implementation use different words for the same concept.

## 5. What is consistent (and should stay that way)

- `Real` prefix for production implementations
- `Stubbed` prefix for test implementations
- `create()` and `createNull()` factory methods on every facade
- `EventEmitter` and `OutputTracker` used the same way across all stubs
- camelCase for all method names

These patterns are solid. Keep them.
