# BUG-20261015-383: CLI plugins command registered --keep-data on non-uninstall subcommands

Status: **Fixed and verified** (2026-10-15).

## Scope and observed behavior

- Scope: `packages/apexo/src/cli/cmd/plugins.ts`, affecting `packages/apexo/test/cli/help/help-snapshots.test.ts`.
- Observed behavior: `test/cli/help/help-snapshots.test.ts` failed on `plugins install` and `plugins add-source` because `--keep-data` appeared in their `--help` output, even though `PluginStore.mutate` explicitly rejects `keepData` on any action other than `uninstall`.

## Expected behavior

- Only `apexo plugins uninstall` should register `--keep-data`; `install`, `add-source`, `remove-source`, `trust`, `enable`, `disable`, and `update` should not advertise `--keep-data`.

## Reproduction steps

1. Run `bun test test/cli/help/help-snapshots.test.ts` from `packages/apexo` when `.option("keep-data", ...)` is unconditionally chained in `actionCommand` in `packages/apexo/src/cli/cmd/plugins.ts`.

## Root cause and fix

- Root cause: `actionCommand` in `packages/apexo/src/cli/cmd/plugins.ts` chained `.option("keep-data", ...)` unconditionally for all plugin actions.
- Fix: Registered `.option("keep-data", ...)` only when `action === "uninstall"`.

## Verification commands and results

- `bun test test/cli/help/help-snapshots.test.ts` (from `packages/apexo`) → `2 pass, 0 fail, 53 snapshots`.
- `bun typecheck` (from `packages/apexo`) → exited `0`.
