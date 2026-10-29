# Native attach blocked on an active Session restore

- Bug ID: BUG-20261028-402
- Scope: Native interactive CLI attach, V2 Session execution, and the mixed legacy/native shell fixture.
- Status: Verified in the real mixed-server terminal acceptance.

## Observed behavior

Attaching the native terminal to an existing Session while its provider turn was waiting for a question or permission hung before the terminal could render the pending blocker. The provider had already been called, but the attach path waited for `POST /session/:id/restore` to finish. That restore request is serialized behind the active process-local drain, which cannot reach a safe boundary while it is waiting for the user's answer.

## Expected behavior

An attach to an active Session must render the durable transcript and pending blocker immediately. It must not start another provider turn or wait synchronously for a restore control that is owned by the already active drain. An idle Session must keep the existing restore behavior so a pending durable input can still schedule continuation.

## Reproduction

From `packages/apexo`, run:

```sh
bun script/grok-native-terminal-tui.mjs --mixed
```

The pre-fix run timed out waiting for `real native terminal pending ordinary`; a direct fixture probe showed that `POST /session/:id/restore` remained pending while the Session was active on a question.

## Root cause

`runNativeInteractive` unconditionally called `located.restore(next.id)` for every existing Session. `Session.restore` enters the process-global execution coordinator. When the coordinator was already blocked inside the provider's question/permission wait, the restore control could not run, so attach never reached terminal rendering.

## Fix

The attach path now checks `located.active()` first. It skips the synchronous restore call when the target Session already has an active local drain and continues directly to transcript/blocker rendering. Idle Sessions still call restore and receive the normal restoration notice.

## Verification

Both native terminal acceptance variants passed after the fix:

```text
bun script/grok-native-terminal-tui.mjs --mixed
  checks: native attach restores pending ordinary without provider work;
          actual terminal approval resumes original native turn and renders canonical SSE;
          existing Session accepts a second durable prompt through native API;
          recorded requests stay on native endpoints on a mixed server
  providerCalls: 3

bun script/grok-native-terminal-tui.mjs
  checks: native attach restores pending ordinary without provider work;
          actual terminal approval resumes original native turn and renders canonical SSE;
          existing Session accepts a second durable prompt through native API
  providerCalls: 3
```
