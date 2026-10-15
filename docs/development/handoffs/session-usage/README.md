# Session usage CLI: implementation and verification

Status: **Implemented and verified** (2026-10-15).

Read [the bounded G06/G12 audit](audit.md) and [the usage proposal](usage-proposal.md) for contract background.

## Implemented modules

- `packages/apexo/src/cli/cmd/usage.ts`: Implements `apexo usage <sessionID> [turn] [--attach URL] [--session-protocol auto|native|compatibility] [--dir PATH] [--password ...] [--username ...]`.
  - Native backend (`backend: "native"`, `accountingScope: "durable-event-ledger"`, `costStatus: "unavailable"`): Reads `v2.session.get` and paginated `v2.session.history` (`after` cursor with non-advancing cursor rejection, `seq`/settlement deduplication, and deterministic `durable.seq` ascending ordering), pairs `SessionEvent.Step.Started` with `Step.Ended`/`Step.Failed`, groups steps into canonical `SessionEvent.Prompted` user turns, excludes `HistoryCopy.Message` imported context from fresh billing (`importedContextSteps` reported separately), retains pre- and post-compaction turns (`compactionCount`), and marks unfinished/failed steps or incomplete/failed/zero-step-interrupted input settlements (`BUG-20261015-381`) with `usageIsIncomplete: true` without inventing zero-token completed calls.
  - Compatibility backend (`backend: "compatibility"`, `accountingScope: "projected-message-history"`, `costStatus: "recorded"`): Reads persisted `Session.Service.get` and `Session.Service.messages` (or attached `client.session.get` and `client.session.messages`), preserving earliest user turn timestamps across out-of-order message arrays (`BUG-20261015-381`) and reporting persisted token and `costUsd` values without recomputing pricing.
  - Distinct nonzero `CliError` diagnostics on `stderr` for missing Session (`Session '<id>' not found.`), no recorded usage (`No usage recorded for session '<id>'.`), missing turn (`Turn <turn> not found in session '<id>'.`), and invalid turn selector (`Turn must be a positive integer...`).
- `packages/apexo/src/index.ts`: Registers `UsageCommand` (`apexo usage`).
- `packages/apexo/test/cli/usage.test.ts`: 10 focused unit, adversarial, and attached-transport tests (129 assertions) covering multi-step turns and model switches, `HistoryCopy.Message` exclusion, manual compaction retention, failed/incomplete steps, duplicate event delivery and non-advancing pagination cursor rejection, missing Session/no usage/missing turn errors, compatibility persisted cost/token reporting, attached native transport selection without silent cross-backend fallback, out-of-order `durable.seq` replay + foreign session event filtering + steered mid-turn prompt attribution + zero-step failed settlement retention, and attached compatibility HTTP server read + fail-closed `--session-protocol native`.

## Verification evidence

- Negative control (`BUG-20261015-381`): Reverting `targetTurn.incompleteFromSettlement = true` in `packages/apexo/src/cli/cmd/usage.ts` causes `packages/apexo/test/cli/usage.test.ts` test 9 (`adversarial native ledger: out-of-order seq, foreign session events, steered mid-turn prompts, and zero-step failed settlement`) to fail (`Expected: 2, Received: 1`).
- `bun test test/cli/usage.test.ts` (in `packages/apexo`): `10 pass, 0 fail, 129 expect() calls`.
- `bun typecheck` (in `packages/apexo`): exited `0`.
- Source CLI and rebuilt Desktop native backend verification:
  - Exercised `apexo usage <sessionID>` and `apexo usage <sessionID> 1` and out-of-range `apexo usage <sessionID> 9` against both `startShellFixture("cli")` (attached and local `createNativeLocalHost`) and `startShellFixture("desktop")` (rebuilt Desktop sidecar backend), confirming identical JSON structure (`120` total tokens, `1` model call, `1` turn, `observedSeq: 6`) and distinct nonzero error reporting.
- Installed Grok Build reference (`1.0.52`) side-by-side verification:
  - Exercised `grok usage <session-id>`, `grok usage <session-id> 1`, `grok usage <session-id> 9`, and missing-session `grok usage 01a13291-0000-7000-8000-000000000000` in an isolated temporary `HOME` alongside Apexo CLI and Desktop fixtures, confirming matching JSON summary/turn/model fields (`inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens`, `totalTokens`, `modelCalls`, `turns`, `byModel`) and matching error messages (`Session '<id>' not found.` and `Turn 9 not found in session '<id>'.`).

