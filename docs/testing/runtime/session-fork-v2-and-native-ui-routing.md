# SessionV2 Fork, Command Sandbox Catalog, and Native Desktop/TUI Routing (`BUG-20261102-706`)

## Bug ID & Scope

- **Bug ID**: `BUG-20261102-706`
- **Category**: Runtime / UI
- **Affected Scope**:
  - `packages/core/src/session.ts`
  - `packages/core/src/session/history-copy.ts`
  - `packages/core/src/session/incarnation.ts`
  - `packages/core/src/command-sandbox.ts`
  - `packages/app/src/utils/server-compat.ts`
  - `packages/app/src/components/prompt-input/submit.ts`
  - `packages/app/src/context/server-sdk.tsx`
  - `packages/app/src/context/server-session-v2-reducer.ts`
  - `packages/app/src/context/server-session.ts`
  - `packages/app/src/components/command-sandbox-dialog.tsx`
  - `packages/app/src/i18n/en.ts`, `packages/app/src/i18n/zh.ts`, `packages/app/src/i18n/zht.ts`
  - `packages/tui/src/context/sdk.tsx`
  - `packages/tui/src/routes/session/dialog-fork-from-timeline.tsx`
  - `packages/tui/src/routes/session/dialog-message.tsx`
  - `packages/tui/src/component/command-sandbox-browser.tsx`
  - `packages/tui/src/component/dialog-command-sandbox.tsx`
  - `packages/apexo/src/cli/cmd/run/runtime.ts`
- **Occurrences**: 1 independent review episode

## Observed vs. Expected Behavior

1. **Forking before the first message inherited later-switched agent/model (`session.ts`)**:
   - **Observed**: When a session started on `build` / `grok-4`, later switched to `plan` / `grok-4-mini`, and was forked before the first user message (`messageID = m1`), the resulting empty slice caused `findLast()` to return `undefined` and fall back to the source session's mutated current configuration (`plan` / `grok-4-mini`).
   - **Expected**: When a truncated slice contains no agent/model switch entries, the forked session must recover the source session's initial creation `agent` and `model` recorded in `SessionEvent.Created`.
2. **Devbox sandbox network copy contradicted actual `unrestricted` policy (`command-sandbox-dialog.tsx`, `i18n/*`)**:
   - **Observed**: Frontend fallback config and localized descriptions described `devbox` as blocking network except allowlisted domains, whereas the runtime `devbox` preset has `network: "unrestricted"` unless narrowed in `.apexo/sandbox.toml`.
   - **Expected**: Built-in fallback metadata and localized copy must reflect `devbox`'s unrestricted default network behavior and prioritize the live catalog's `network` and `allowDomains` fields.
3. **Desktop first prompt failed with HTTP 400 after selecting a command sandbox profile (`server-compat.ts`, `submit.ts`)**:
   - **Observed**: Creating a session with a non-`off` sandbox profile (`npm-only`, `workspace`, etc.) forced V2 creation (`POST /api/session`), but sending the first prompt on a dual-protocol server still routed through V1 `POST /session/:id/prompt_async`, which rejected confined sessions with HTTP 400.
   - **Expected**: Sessions created or forked via V2 (or sealed with a non-`off` command sandbox) must route `prompt`, `command`, `shell`, `interrupt`, and `fork` through V2 endpoints even when the server's detected default protocol is `v1`.
4. **Fullscreen Native TUI `/fork` called legacy V1 fork and broke subsequent prompts (`dialog-fork-from-timeline.tsx`, `dialog-message.tsx`, `sdk.tsx`)**:
   - **Observed**: `/fork` in fullscreen Native TUI called `sdk.client.session.fork` directly instead of `sdk.forkSession`, copying rows via legacy fork pathways without V2 history-copy projection and causing subsequent native prompts to fail with `UNIQUE constraint failed: session_message.session_id, session_message.seq`.
   - **Expected**: Fullscreen TUI timeline and message fork dialogs must call `sdk.forkSession(sessionID, messageID)` and dispatch to the native V2 fork transport when running in native mode.
5. **Desktop UI stayed stuck on `Stop` and missed assistant output on Native V2 sessions (`server-sdk.tsx`, `server-session-v2-reducer.ts`, `server-session.ts`)**:
   - **Observed**: During V2 execution (`session.next.*` events), the model reply completed in SQLite, but the Desktop UI never rendered the assistant turn and remained in `busy` (`Stop`) state.
   - **Expected**: `server-sdk.tsx`, `server-session-v2-reducer.ts`, and `server-session.ts` must bridge `session.next.*` events (including ephemeral `session.next.*.delta` and `timestamp` → `created`), preserve `data.session_message` during `projectV2` without `indexLegacyMessage` overwriting assistant content with `content: []`, fetch V2 messages for native sessions on dual-protocol servers, and transition `session_status` back to `idle` when the step/input settles.
6. **Native TUI command sandbox dialog showed compatibility-flow banner (`command-sandbox-browser.tsx`)**:
   - **Observed**: In Native TUI mode, the command sandbox browser still displayed `"This terminal creates Sessions through the compatibility flow..."`.
   - **Expected**: When running in Native mode (or inspecting a session with an active sandbox profile), display the native sealed-at-creation note while preserving compatibility guidance for legacy compatibility mode.
7. **Desktop sandbox session permission prompts did not appear (`server-sdk.tsx`, `server-event.ts`, `server-compat.ts`, `permission.tsx`, `bootstrap.ts`)**:
   - **Observed**: Ephemeral `permission.v2.asked` / `permission.v2.replied` / `question.v2.*` events emitted on `/global/event` were ignored by `adaptLegacySyncEvent`, so the Desktop UI stayed stuck on "Thinking" without showing Approve/Deny buttons when a tool requested approval.
   - **Expected**: `adaptLegacySyncEvent` must adapt `permission.v2.*` and `question.v2.*` events into `permission.*` / `question.*`, and `createV1Api` / `permission.tsx` / `bootstrap.ts` must route permission/question replies and pending list queries to V2 endpoints for native sessions on dual-protocol servers.
8. **Desktop clicking Stop during an interrupted tool step left the session in `busy` state (`server-session.ts`, `submit.ts`, `session.tsx`, `server-compat.ts`)**:
   - **Observed**: Stopping a session while a tool call was waiting for approval or executing emitted `session.next.tool.failed` (`"Tool execution interrupted"`) followed by `session.next.step.ended` with `finish: "tool-calls"`, which `applyV2` did not treat as a terminal idle transition.
   - **Expected**: `applyV2` and `interrupt()` must transition `session_status` to `idle` and clear stale pending `permission` / `question` entries when a tool step is interrupted.
9. **`apexo session fork <id>` failed on default compatibility CLI sessions (`cli/cmd/session.ts`, `session/session.ts`)**:
   - **Observed**: Running `apexo session fork <id>` on a session created by default `apexo run ...` failed with `History source uses legacy transcript storage` (exit code 1).
   - **Expected**: When `SessionV2.Service.fork` reports legacy transcript storage, `apexo session fork` must transparently fall back to `Session.Service.fork` (loading the source session's directory instance and preserving `--message` and `--title` options).

## Root Cause

- `SessionV2.fork` fell back to `source.agent` / `source.model` whenever `findLast` found no switch or assistant message in `snapshot.messages`, ignoring whether `snapshot.truncated` had sliced before those switches.
- `createCompatibleApi` in `packages/app/src/utils/server-compat.ts` gated `prompt`, `command`, `shell`, and `interrupt` solely on server-level `await input.protocol === "v2"`, so V2-created sandboxed sessions and V2-forked sessions on dual-protocol servers (`protocol === "v1"`) fell through to legacy V1 endpoints.
- `server-session-v2-reducer.ts` and `server-session.ts` only handled legacy `session.*` event names (`session.step.started`, `session.text.started`, `session.execution.succeeded`) and not `session.next.*` (`session.next.step.started`, `session.next.text.started`, `session.next.step.ended`, `session.next.input.execution.settled`); additionally, `projectV2` invoked `apply({ type: "message.updated" })` which triggered `indexLegacyMessage` and clobbered `data.session_message[sessionID]` with empty assistant `content: []`.
- `DialogForkFromTimeline` and `DialogMessage` bypassed `sdk.forkSession` and invoked `sdk.client.session.fork` directly.

## Fix

1. Added `initial` (`agent` / `model` from the source session's `SessionEvent.Created` event) to `SessionHistoryCopy.Snapshot` and used `snapshot.initial` when `snapshot.truncated` is true and no switch/assistant record exists in the kept slice. Also made `SessionHistoryCopy.captureForFork` fail with `Conflict` when a session has zero V2 `session_message` rows but non-zero legacy `message` rows so dual-protocol clients fall back to V1 fork for legacy transcripts.
2. Updated `DEFAULT_PROFILES.devbox` in `command-sandbox-dialog.tsx` and the `en.ts`/`zh.ts`/`zht.ts` copy to describe `devbox`'s unrestricted default network accurately.
3. Tracked native V2 sessions via `markNativeSession` / `isNativeSession` in `server-compat.ts` and `submit.ts`, routing `create` (with `commandSandbox !== "off"`), `fork`, `prompt`, `command`, `shell`, `interrupt`, and `active` through V2 endpoints even when `protocol === "v1"`.
4. Added full `session.next.*` event reduction in `server-session-v2-reducer.ts`, guarded `indexLegacyMessage` with `if (projectingV2) return` in `server-session.ts`, bridged `session.next.*.delta` and `created` timestamps in `server-sdk.tsx`, and updated `applyV2` busy/idle status transitions and `fetchMessages` V2 fallback in `server-session.ts`.
5. Wired `sdk.forkSession` in `packages/tui/src/context/sdk.tsx` to call `selected.fork` in native mode and updated `DialogForkFromTimeline` and `DialogMessage` to use `sdk.forkSession`.
6. Added `native` detection to `CommandSandboxActions` and updated `command-sandbox-browser.tsx` to display the native sealed-profile note when running in native mode.

## Verification

- `bun turbo typecheck --concurrency=2` (all 24 packages pass)
- `bun test --conditions=solid --only-failures --preload ./happydom.ts ./src/utils/server-native-prompt.test.ts ./src/context/sync.test.ts ./src/context/server-session-v2-reducer.test.ts` in `packages/app`
- `bun test ./test/session/fork-and-sandbox-catalog.test.ts` in `packages/apexo`
