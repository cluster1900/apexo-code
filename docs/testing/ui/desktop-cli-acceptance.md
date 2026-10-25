# Desktop and TUI acceptance defects

Baseline for all entries: `a99a9b3812b5cba19dfee08f1bdd05d0aac16ac2`; macOS 26.6.2 arm64; Bun 1.3.14; agy 1.4.7; Gemini 3.8 Flash Low. Desktop uses Electron 42.3.3 and its real bundled Node sidecar. The initial audit made no fixes; the follow-up below records the changes and regression.

## BUG-20261025-004 — Duplicate user messages in the Context inspector

- Status: fixed; verified in the follow-up regression. GitHub: [#150](https://github.com/cluster1900/apexo-code/issues/150).
- Scope: Desktop context projection and counters.
- Reproduction: submit a coding task, approve single-use tools, open Context, and inspect Raw messages; submit a continuation and inspect again. Compare with the authenticated server message endpoint.
- Observed: first reproduction shows 9 messages / 3 users while the server returns 8 / 2; the latest user ID appears twice. After continuation, 14 / 4 includes the new user ID twice. Main timeline shows each prompt once.
- Expected: each message ID appears exactly once and counters agree with the server.
- Root cause: optimistic and admitted messages can share an ID but have different timestamps. Binary search used timestamp plus ID as identity, inserting a second message when confirmation changed the timestamp. Both legacy and active server-session caches had this path.
- Fix: reconcile identity by message ID and use the timestamp only to determine ordering; replace/reposition changed-timestamp events and retain optimistic parts without duplicate messages.
- Regression: actual cache tests cover confirmation ordering and repeated events. In a fresh production Desktop window, two consecutive prompts after import produce 10 messages / 3 users; all 10 raw IDs are unique and match the server exactly. An initial partial fix still duplicated the active-cache path; that failed intermediate run was not counted as a pass.

## BUG-20261025-005 — An empty interrupted TUI queue poisons future queue submissions

- Status: fixed; verified in the follow-up regression. GitHub: [#151](https://github.com/cluster1900/apexo-code/issues/151).
- Scope: TUI queue lifecycle.
- Reproduction: with no queued drafts, run a 30-second shell sleep; press Escape twice to interrupt; submit a new 8-second shell task normally; while active submit another prompt using Alt+Enter; wait until idle.
- Observed: the new draft stays PAUSED indefinitely; only Alt+Up edit is shown. Popping it with Alt+Up and submitting Enter succeeds; a later queue control auto-delivers.
- Expected: interrupting an empty queue does not pause future queued work after normal execution resumes, or a clear resume action is provided.
- Root-cause evidence: prompt interruption unconditionally calls queue.pause; queue.push preserves the paused flag; only pop resets it when the queue becomes empty.
- Fix: pause only a nonempty queue and clear its paused state when successful delivery empties it.
- Regression: actual queue tests cover empty interruption, existing paused drafts and later recovery. In the real tmux TUI, interrupting a 30-second shell task with an empty queue no longer poisons future work: a later prompt queued during an active 30-second task automatically runs and replies `TUI_QUEUED_DURING_ACTIVE_OK`.

## BUG-20261025-006 — Desktop session import fails authentication

- Status: fixed; verified in the follow-up regression. GitHub: [#152](https://github.com/cluster1900/apexo-code/issues/152).
- Scope: native Desktop export/import workflow.
- Reproduction: export an existing conversation via More options → Export and native Save dialog; use Cmd+K → Import session; select the saved JSON with the native Open dialog. Repeat.
- Observed: both attempts report Failed to import session / Import failed (401). Export parses and contains 15 unique message IDs. Other authenticated operations work.
- Expected: selected-server credentials accompany import; valid history restores.
- Root cause: importSessionFromFile used raw fetch with optional headers, while both layout/titlebar callers omitted authentication headers.
- Fix: require the selected server connection, derive its Basic authentication, encode the directory header and use the platform transport when available. Both callers pass their active connection.
- Regression: a real HTTP test checks selected-server credentials, platform transport, non-ASCII directory encoding and the complete export payload. Native Save → Cmd+K Import session → native Open succeeds in Electron, restores all 6 messages under a new session ID, and accepts two subsequent Gemini prompts.

No recurring constraint is promoted: these entries do not establish 3–5 independent occurrences of the same root-cause mistake.

Full gate and environment details: [fix regression](../desktop-cli/2026-10-25-regression.md).
