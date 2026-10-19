# BUG-20261018-445: Grok-compatible subagent rendered as "Unknown Agent"

- Status: Fixed; focused test and live headless run pass.
- Scope: `apexo run` inline tool rendering (`packages/apexo/src/cli/cmd/run/tool.ts`, `runTask`).

## Observed and expected behavior

With `--profile grok-build`, the model spawns subagents through the Grok-shaped `task` tool, which usually omits `subagent_type`. The headless output then showed `• Read calc.py and count lines Unknown Agent`. The adapter runs the `general` agent when the type is omitted (Grok's default `general-purpose`), and the structured snapshot already says `General Task`.

## Reproduction

From a scratch repository: `bun run <repo>/packages/apexo/src/index.ts run --profile grok-build --auto "Spawn ONE background subagent to count the lines of calc.py; reply spawned, then RESULT: <answer>."`

## Root cause and fix

`runTask` defaulted the missing type to `unknown`, while `snapTask` and the adapter default to `general`. The inline label now defaults to `general`, so it reads `General Agent`.

## Verification

- `bun test test/cli/run/tool-inline.test.ts` from `packages/apexo`: 1 pass (it expects `General Agent`, which the old default did not produce).
- `bun typecheck` in `packages/apexo`: clean.
