# CLI parity with Grok Build 1.0.61/1.0.62 headless and session contracts

- Status: Fixed; focused tests, negative controls and live CLI/Grok Build comparisons pass (see Verification).
- Scope: `apexo run` (compatibility headless path), `-s/--session` for `run`, the interactive terminal and `attach`, server session search, and `apexo export`.
- Reference: installed Grok Build 1.0.62 (`~/.grok/docs/user-guide/14-headless-mode.md` "Workflows and Background Work", `17-sessions.md`, `CHANGELOG.md` 1.0.61/1.0.62).

## BUG-20261018-441: Headless run exited before background work woke its follow-up turn

- Observed: with `--profile grok-build`, a prompt that started a background command (`sleep 8 && echo BGDONE-42`) printed `started` and exited after about 13 s. The completion wake turn never ran, so `BGDONE-42` was never reported. On the same prompt, Grok Build 1.0.62 printed `started` and then `BGDONE-42`.
- Expected (Grok Build 1.0.62): a headless run waits for background work it started, for up to 600 s after the latest turn ends, and prints the turn that each completion wakes. `--background-wait-timeout <secs>` changes the limit. When the limit runs out, the run stops the remaining work, explains on stderr, and exits 1. `--no-wait-for-background` exits after the first turn.
- Root cause: the compatibility event loop in `packages/apexo/src/cli/cmd/run.ts` broke out on the first `session.status idle` event, then the process exited and the in-process server went with it.
- Fix: on idle, the loop checks the session's running background tasks (`experimental.task.list`, excluding schedulers). While any are running, it keeps consuming events, and a 250 ms settle timer applies the wait limit counted from the latest idle. A completed task that wakes no turn within 2 s ends the wait. When the limit runs out, the loop aborts the session first, so stopped work can't wake another billable model turn, then cancels the tasks and reports `the wait for background work ran out after N s and exit stopped K background task(s) (…)`. The SSE subscription now takes an abort signal so the loop can end without another event. `streaming-json` emits `end` only once, at the true end. Attach mode is unchanged.
- Known boundary: native headless (`--session-protocol native`) still rejects owned background shell by design (`bash.ts`), so this applies to the compatibility path.

## BUG-20261018-442: `-s` accepted only session IDs

- Observed: `apexo run -s "<title>"` failed with `Session not found`, and the interactive terminal rejected a non-ID with `Invalid session ID`.
- Expected (Grok Build `--resume <id-or-title>`): an ID-shaped value means an ID. Otherwise the value matches a title of the current directory, either exactly (ignoring case) or as the same words joined by any separators. Several matches fail as ambiguous.
- Fix: the shared `resolveSessionReference`/`sessionMatches` helpers in `packages/sdk/js/src/v2/grok-commands.ts`; `resolveSession` in `run.ts`; `validateSession` now returns the resolved ID, used by `tui.ts`, `attach.ts` and `native-local-fullscreen.ts`. Ambiguous and missing references list candidates or explain the miss.

## BUG-20261018-443: Session search used a single substring match

- Observed: server `search` used `LIKE %query%`, so `login fix` did not find `Fix login bug`.
- Expected (Grok Build 1.0.61 resume picker): titles containing every typed word in any order, regardless of separators.
- Fix: `titleSearch` in `packages/apexo/src/session/session.ts` requires every word (`AND` of `LIKE`) or a session-ID prefix, for both the project and global lists.

## BUG-20261018-444: `apexo run` wrapped spaced prompts in literal quotes

- Observed: `apexo run "Read calc.py, fix the bug"` sent `"Read calc.py, fix the bug"` (with quote characters) to the model, and `apexo export` showed the quotes in the transcript.
- Expected: the prompt arrives as typed, like `grok -p`.
- Root cause: the shell-style re-quoting meant for `--command` arguments was also used for the prompt text and the derived title.
- Fix: prompts and titles use the raw input. `--command` keeps its quoting.

## BUG-20261018-446: `apexo export` had no readable transcript output

- Observed: export wrote JSON to stdout only.
- Expected (Grok Build `export <SESSION_ID> [OUTPUT] [-c]`): a readable Markdown transcript, an optional output file that must not exist yet (left unchanged and explained when it does), and a clipboard option.
- Fix: `--format markdown` (default stays `json`, so `apexo import` keeps working), `[output]` written with an exclusive create (`wx`), and `-c/--clipboard`. `--sanitize` stays JSON-only.

## Reproduction

From `packages/apexo`, with a scratch Git repository as the working directory and a configured provider:

```sh
bun run src/index.ts run --profile grok-build --auto "Start \`sleep 8 && echo BGDONE-42\` as a BACKGROUND task, reply exactly started, and report its output when it finishes."
bun run src/index.ts run -s "fix-bug-in-calc.py-add-function" "what did we fix?"
bun run src/index.ts export <sessionID> existing-file.md --format markdown
```

## Verification

- `bun test test/cli/run/run-process.test.ts`: 18 pass. New cases: background wake printed (3 agent turns), wait limit stops work with exit 1 and no further agent turn, `--no-wait-for-background`, and verbatim prompt. The verbatim-prompt case fails when the old quoted text is restored (negative control).
- `bun test test/server/session-list.test.ts`: 12 pass, including every-word search.
- `bun test test/server/httpapi-sdk.test.ts -t session`: 5 pass, including `-s` title, ambiguity and miss.
- `bun test test/cli/export-process.test.ts`: 1 pass (Markdown stdout, new file, refused overwrite leaves the file unchanged).
- `bun test test/grok-commands.test.ts` in `packages/sdk/js`: 22 pass.
- `bun typecheck` in `packages/apexo`: clean.
- Live, against a real provider (Antigravity Gemini 3.5 Flash Lite) and installed Grok Build 1.0.62 on the same prompts:
  - Background command: Apexo prints `started` then `BGDONE-42`, exit 0, matching Grok.
  - Background subagent: both print `spawned` then `RESULT: 2`.
  - `-s` by title: separator-joined title resumed the right conversation; duplicate titles were refused as ambiguous; an unknown title was refused.
  - Export: Markdown output; an existing target was refused and left unchanged, matching Grok's `Not exported: … already exists`.
