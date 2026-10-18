# BUG-20261018-403 — `PluginStore.tag` failed on macOS symlinks, commit signing, and missing git identity

- **Bug ID**: `BUG-20261018-403`
- **Category**: Runtime (`runtime`)
- **Affected Scope**:
  - `packages/core/src/plugin-store.ts`
  - `packages/apexo/test/plugin/validate.test.ts`
- **Occurrences**: 1 independent episode.

## Observed Behavior

Running `bun test test/plugin/validate.test.ts` in `packages/apexo` failed in `describe("plugin tag")` with:
- Tag name generated as `sample-v1.2.0` instead of `v1.2.0` for a root plugin repository created inside `/var/folders/...` on macOS.
- Annotated tag creation (`git tag -a`) failing when the developer environment has `tag.gpgSign=true` or `commit.gpgsign=true`, or when git `user.name` or `user.email` is not configured in the repository or environment.

## Expected Behavior

`PluginStore.tag` should recognize a plugin at the repository root as `v<version>` even when the path contains a symlinked parent directory (such as `/var` -> `/private/var` on macOS), and should create the unsigned annotated release tag reliably even when global git config enables GPG signing or lacks a configured `user.name` or `user.email`.

## Reproduction Steps

Run in `packages/apexo`:

```sh
bun test test/plugin/validate.test.ts
```

## Root Cause

1. `git rev-parse --show-toplevel` returns the canonicalized `/private/var/...` path on macOS, whereas `result.path` (`path.resolve(input)`) kept `/var/...`, so `top === result.path` evaluated to `false` and fell back to the nested marketplace prefix (`${result.name}-v${result.version}`).
2. `git tag -a` creates an annotated tag object, which invokes GPG signing if `tag.gpgSign` / `commit.gpgsign` is enabled in the user's global git config and requires committer identity (`user.name` and `user.email`).

## Fix

1. Resolve both `top` and `result.path` with `fs.realpath` before comparing whether the plugin is at the repository root.
2. Pass `-c tag.gpgSign=false` to `git tag -a` and independently supply fallback `-c user.name=apexo` and `-c user.email=plugin@apexo.local` when `git config user.name` / `GIT_COMMITTER_NAME` or `git config user.email` / `GIT_COMMITTER_EMAIL` is not set.
3. Disable GPG signing in the test fixture's `git init` / `git commit` setup in `packages/apexo/test/plugin/validate.test.ts`.

## Verification

- `bun test test/plugin/validate.test.ts` in `packages/apexo`: 5 pass, 0 fail.
