# Desktop and TUI acceptance defects

Baseline for all entries: `a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2`; macOS 26.6.2 arm64; Bun 1.3.14; agy 1.4.7; Gemini 3.8 Flash Low. Desktop uses Electron 42.3.3 and its real bundled Node sidecar. No fixes were made.

## BUG-20261025-004 — Duplicate user messages in the Context inspector

- Status: unresolved. GitHub: [#150](https://github.com/cluster1900/apexo-code/issues/150).
- Scope: Desktop context projection and counters.
- Reproduction: submit a coding task, approve single-use tools, open Context, and inspect Raw messages; submit a continuation and inspect again. Compare with the authenticated server message endpoint.
- Observed: first reproduction shows 9 messages / 3 users while the server returns 8 / 2; the latest user ID appears twice. After continuation, 14 / 4 includes the new user ID twice. Main timeline shows each prompt once.
- Expected: each message ID appears exactly once and counters agree with the server.
- Root cause: unknown. This is not evidence of duplicate provider execution.
- Fix: none. Verification: two consecutive prompts reproduce.

## BUG-20261025-005 — An empty interrupted TUI queue poisons future queue submissions

- Status: unresolved. GitHub: [#151](https://github.com/cluster1900/apexo-code/issues/151).
- Scope: TUI queue lifecycle.
- Reproduction: with no queued drafts, run a 30-second shell sleep; press Escape twice to interrupt; submit a new 8-second shell task normally; while active submit another prompt using Alt+Enter; wait until idle.
- Observed: the new draft stays PAUSED indefinitely; only Alt+Up edit is shown. Popping it with Alt+Up and submitting Enter succeeds; a later queue control auto-delivers.
- Expected: interrupting an empty queue does not pause future queued work after normal execution resumes, or a clear resume action is provided.
- Root-cause evidence: prompt interruption unconditionally calls queue.pause; queue.push preserves the paused flag; only pop resets it when the queue becomes empty.
- Fix: none. Verification: two interruption/new-task/queue sequences reproduce; manual recovery and a subsequent normal queue control pass.

## BUG-20261025-006 — Desktop session import fails authentication

- Status: unresolved. GitHub: [#152](https://github.com/cluster1900/apexo-code/issues/152).
- Scope: native Desktop export/import workflow.
- Reproduction: export an existing conversation via More options → Export and native Save dialog; use Cmd+K → Import session; select the saved JSON with the native Open dialog. Repeat.
- Observed: both attempts report Failed to import session / Import failed (401). Export parses and contains 15 unique message IDs. Other authenticated operations work.
- Expected: selected-server credentials accompany import; valid history restores.
- Root-cause evidence: importSessionFromFile uses raw fetch with optional headers, while both layout/titlebar callers omit authentication headers. This matches the observed 401. Transcript restoration after authorization remains unverified.
- Fix: none. Verification: two real native-dialog attempts fail.

No recurring constraint is promoted: these entries do not establish 3–5 independent occurrences of the same root-cause mistake.
