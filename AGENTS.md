# Agent notes

Everything structural here is discoverable by reading the repo. These are the things that are not.

- The workflow is strict TDD: red, green, refactor. Commit messages follow the pattern `test: red - <behaviour>`, `test: green - <behaviour>`, `refactor: <what changed>`.
- No mocks, spies or stubbing libraries anywhere in the tests. We use James Shore's Nullables: https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks. Infrastructure wrappers expose `create()` and `createNull()` factories. Assert on state and `OutputTracker` output, never on call records.
- Nullable unit tests and integration tests live in separate files (`x.test.ts` and `x.integration.test.ts`). Do not merge them.
- `npm run test:integration` needs a local MongoDB. Without one the mongo tests hang for 15 seconds each and then fail. That is the environment, not a regression.
- Prose and docs are British English. The product is "EkoLite" in prose and `ekolite` in code and package names.
