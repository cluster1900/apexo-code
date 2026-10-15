# BUG-20261015-384: Media options E2E helper returned before native Session drain completion

Status: **Fixed and verified** (2026-10-15).

## Scope and observed behavior

- Scope: `packages/apexo/test/e2e/v2-media-options.e2e.test.ts` (`finished` helper).
- Observed behavior: During full-suite runs, `explicit media document validation preserves authority: native` intermittently failed (`Expected: "saved:1:1024", Received: ""`) after `deleting an S3 download joins ownership and cannot publish into a reused Session` tore down its `TestInstance` scope while the native Session drain was still finalizing post-turn work (additionally exacerbated by duplicate `SessionMemoryOperation` instances from `BUG-20261015-382`).

## Expected behavior

- The `finished(id, text)` helper in `packages/apexo/test/e2e/v2-media-options.e2e.test.ts` must wait until both the assistant message has `time.completed` set and `/api/session/active` no longer lists `id` in `running` before exiting the test scope.

## Reproduction steps

1. Run `bun test test/e2e/v2-media-options.e2e.test.ts` from `packages/apexo`.

## Root cause and fix

- Root cause: `finished(id, text)` in `packages/apexo/test/e2e/v2-media-options.e2e.test.ts` returned as soon as the streamed text part matched `text`, before `message.time.completed` was persisted and before `SessionExecutionLocal` removed the session from `/api/session/active`.
- Fix: Updated `finished(id, text)` to poll `/api/session/active` (`!(id in running)`) and check `Boolean(row.info?.time?.completed)` in addition to matching the assistant text.

## Verification commands and results

- `bun test test/e2e/v2-media-options.e2e.test.ts` (from `packages/apexo`) → `12 pass, 0 fail, 89 expect() calls`.
