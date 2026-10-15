# Native Goal plan progress

Status: implementation applied. Native focused/lifecycle tests and CLI acceptance
passed. Installed-reference comparison passed four checks with 14 provider requests.
Shared Apexo typechecking and coordinated Desktop acceptance passed. Browser and
native-window checks passed in English, Simplified Chinese and Traditional Chinese.
All four terminal modes passed after the fullscreen keyboard-priority fix.

A Goal keeps its original plan and finalized report hashes unchanged. Its main
worker can record completed task numbers and concise deviations through the
existing `update_goal` tool. These annotations are advisory work notes. They do
not change acceptance criteria, complete a Goal, bypass verification, or reset
budget, blocker or no-progress safeguards.

## Public contract

`Goal.Info.planProgress` is optional and contains `completed` task ordinals and
`deviations`. `Goal.Update.plan_progress` accepts optional `complete` ordinals and
one optional `deviation`. Existing callers remain valid.

Task ordinals are zero-based and stable within the original plan's explicit
`Task checklist` section. Nested headings remain in that section; fenced
examples, numbered acceptance criteria, non-goals and unrelated prose do not
assign ordinals. Ambiguous duplicate checklist sections, unsupported plans and
more than 128 checklist tasks cannot be used for task updates. The actual parsed
plan, not only the numeric wire range, validates every ordinal.

Completed ordinals are unique, sorted and monotone, with at most 128 entries in
the range 0–127. Initially checked plan tasks remain completed. Deviations are
trimmed and deduplicated, with at most 16 notes and 512 UTF-8 bytes per note.
Oversized or invalid updates fail with a typed Goal validation error; nothing is
silently truncated or partially saved. A deviation-only plan need not contain a
checklist. Exact repeated annotations do not increment the Goal revision.

The shared state mutation requires the current executing worker attempt. Native
and compatibility tools retain Session ownership checks and request the canonical
`update_goal` permission. Reviewers, strategists, summary children, paused,
terminal, replaced and stale attempts cannot update worker progress. The original
plan cannot be replaced by a later worker finish receipt.

Worker context includes task numbers and notes. Explicit evaluator next steps
remain authoritative; the first unfinished task is only a fallback. Reviewers
receive the same annotations labeled advisory, alongside the original objective
and immutable plan. Status reads preserve the structured progress for App and
terminal presentation. Model-facing long task labels are visibly abbreviated;
the stored plan and deviation notes are never truncated.

## Reference and adaptation

Pinned Grok Build revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` instructs
workers to check plan tasks and append deviations in
`crates/codegen/xai-grok-shell/src/session/templates/goal_plan_block.md` lines 5–8.
`session/goal_next_step.rs` mines the next unchecked task. The reference captures
an original baseline once in `acp_session_impl/goal_support.rs` and supplies plan
changes to the verifier in `goal_classifier.rs`.

The isolated installed Grok Build 1.0.52 comparison exercised actual worker writes:
both tasks were checked, a deviation persisted, the continuation advanced to the
second task, the original baseline stayed unchanged, and the verifier received
the plan changes. Four checks passed with 14 provider requests.

Apexo represents these updates in durable Goal state instead of editing finalized
plan reports. It retains its own Sessions, tools, permissions and execution
ownership. The installed comparison is behavioral evidence, not verification of
Apexo or a product dependency.

## Verification

- Core `bun typecheck` passed after the initial implementation.
- Six-file focused/lifecycle gate passed 180 tests, one existing skip and 1,104
  assertions, including actual compatibility tool permissions and native default-on
  closing-summary behavior.
- Shared Apexo `bun typecheck` passed after coordinated Client/SDK generation.
- `bun script/grok-goal-progress.mjs cli` passed valid, invalid and permission-denied
  scenarios, each with 11 provider requests and 1,320 tokens. It checks unchanged
  report hashes, independent review and reopened status. The coordinated `desktop`
  run also passed all three cases with the same request and token counts. The
  final coordinated artifact was checked again with the same three successful cases.
- Installed comparison: `bun script/grok-goal-progress-official.mjs` passed four
  checks with 14 requests before native implementation.

## Terminal presentation checkpoint

Compact and expanded native Goal action PTYs each passed nine checks with actual
worker `update_goal` calls. Home and arrow keys exposed task completion, the
independent-verification hint and the deviation in the original viewports.
Both runs also verified unchanged report hashes and report/summary navigation.
Final production browser and native-window runs each passed 15 checks, including
all three locales, actual worker progress, immutable report hashes, successful
native project bootstrap and no workspace reload error. The initial
actual mini run passed ten checks. Fullscreen exposed a higher-priority Session
shortcut that closed the Goal dialog before its scroll listener ran; the dedicated
Goal key bindings fixed it. Post-fix actual mini/fullscreen each passed ten checks,
and compact/expanded native action PTYs each passed nine. The coordinated TUI
`bun typecheck` also passed after Client/SDK generation; see BUG-20261014-273.
