# Desktop shell wake output was persisted but not projected live

- Bug ID: BUG-20261028-403
- Scope: Desktop/legacy event compatibility, App Session message projection, timeline synthetic-turn boundaries, and the shell UI acceptance fixture.
- Status: Verified in the production renderer bundle through Playwright for CLI and Desktop runtimes.

## Observed behavior

The shell provider returned `SHELL_WAKE_OK`, and `GET /session/:id/message` contained the completed background prompt plus the final assistant text. The Desktop renderer displayed the first `SHELL_ACK` but timed out waiting for `SHELL_WAKE_OK`. The same failure reproduced through the legacy `/global/event` stream while the raw SSE stream contained the wake `message.updated` and `message.part.updated` events.

## Expected behavior

Desktop and CLI renderers must display the assistant wake output as soon as the legacy event stream delivers it. Synthetic background-completion messages remain hidden from the visible-user-message list, while their subsequent assistant output remains part of the current timeline.

## Reproduction

From `packages/apexo`, with the production App bundle built:

```sh
bun run --cwd ../app build
bun script/grok-shell-ui.mjs desktop
```

Before the fix, the run timed out at `getByText('SHELL_WAKE_OK', { exact: true }).last()` even though the failure evidence history contained the marker and `calls.json` recorded a wake provider call.

## Root cause

The legacy event stream delivered V2 durable sync payloads in addition to compatibility events, but the App discarded sync payloads and only indexed each legacy message once with no later part refresh. Consequently, `session_message` stayed at the initial transcript. When the live synthetic completion arrived, the timeline treated it as an unloaded user boundary and sliced away the assistant turn that contained the wake output.

## Fix

- The App legacy event adapter now turns a durable sync payload into a typed current event instead of dropping it, preserving V2 metadata for consumers that can use it.
- `createServerSession` refreshes the legacy `session_message` projection whenever a message part changes, so synthetic completion text and new assistant messages stay in the timeline source.
- The timeline boundary ignores a user message whose text parts are synthetic, but still includes all following assistant messages.
- The shell fixture pins the model-level provider URL to its isolated OpenAI-compatible server. This prevents a models.dev model override from sending mixed fixture calls to the real provider endpoint.

## Verification

The rebuilt renderer passed all three shell interactions in both runtimes:

```text
bun script/grok-shell-ui.mjs desktop
  click, hotkey, message: pass; SHELL_WAKE_OK rendered live

bun script/grok-shell-ui.mjs cli
  click, hotkey, message: pass; SHELL_WAKE_OK rendered live

bun script/grok-shell-ui.mjs desktop --tasks
  task-list-output-cancel-isolation: pass

bun script/grok-session-wait.mjs cli
  4 checks passed; providerCalls: 1
```

The App typecheck and production build also passed before the Playwright runs.
