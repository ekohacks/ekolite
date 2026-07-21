# Releasing

EkoLite ships to npm without a token leaving anyone's machine. A release is two small human decisions, a version PR and a GitHub Release, and the machines do the rest.

## The flow

1. **Open a release PR.** Branch `release/vX.Y.Z` off `main`. Bump `version` in `package.json`, and write the CHANGELOG entry: everything merged since the last release that a consumer can feel, in plain sentences with PR references. Title it `chore: release X.Y.Z`, let CI go green, merge.
2. **Cut the GitHub Release.** Tag `vX.Y.Z` on `main`, notes lifted from the CHANGELOG entry. Publishing the Release fires `.github/workflows/publish.yml`.
3. **Approve the gate.** The workflow waits on the `release` environment; a maintainer approves the deployment under Actions.
4. **The workflow publishes.** It authenticates with OIDC trusted publishing: npmjs.com trusts this repo, this workflow and this environment, so there is no stored secret to leak or rotate. `prepublishOnly` re-runs typecheck, tests and build as the last gate, then `npm publish --provenance` ships with an attestation linking the package on npm back to this repo and this exact run.

## Before cutting

- `main` matches `origin/main`: `git pull` before anything else. The release branch, the version bump and the PR are all built on whatever the local `main` points at. A stale `main` either stops the cut half-way as a merge conflict on `package.json`, or worse, merges cleanly and ships a release that silently omits work already on `origin/main`.
- `npm run test:package` passes: the consumer smoke installs the packed tarball into a project outside the repo and proves every export entry from a consumer's side.
- The lockfile resolves only to `registry.npmjs.org`. A local mirror config can quietly rewrite tarball URLs; `grep npmmirror package-lock.json` should find nothing.
- The CHANGELOG entry reads like release notes, because it becomes them.

## Verify

`npm view ekolite version` shows the new version, and the package page on npm carries the provenance badge.
