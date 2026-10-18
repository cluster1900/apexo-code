# BUG-20261018-400: TUI Attach Misses Pending Permission and Question Requests

- **Scope:** TUI compatibility sync (`packages/tui/src/context/sync.tsx`) when a client attaches to a server where a session is already waiting on a permission or question request.
- **Occurrences:** One reproduced episode, found by the `/dashboard` PTY flow.
- **Status:** Fixed and verified on CLI; Desktop already seeded these lists at bootstrap.

## Observed and expected behavior

A session asked for `bash` permission before the TUI attached. The server listed the request (`GET /permission`), but the TUI store never received it: the session row showed as Working, the dashboard chips read `⋮ 2 working` with no `◆ awaiting`, and the agent view could not answer the request. Expected: the attached client shows the pending request immediately, the same as Desktop, whose global sync bootstrap loads `permission.list()` and `question.list()`.

## Reproduction

Use the dashboard fixture in `packages/apexo/script/grok-goal-fixture.mjs`. It seeds a session whose turn asks for `bash` permission, then attaches the TUI (`bun script/grok-slash-tui.mjs --dashboard`). Before the fix, the flow timed out waiting for the `◆ 1 awaiting` header chip.

## Root cause and fix

The compatibility store filled `permission` and `question` only from `permission.asked` and `question.asked` events. A client that attaches after the event never sees it, and bootstrap had no list call. The fix adds non-blocking `permission.list` and `question.list` calls to bootstrap. Each request is merged by ID into its session's list, so a request that also arrives as a live event is not duplicated.

## Verification

Pinned Bun 1.3.14:

- `packages/tui`: `bun run typecheck` passes.
- `packages/apexo`: `bun script/grok-slash-tui.mjs --dashboard` passes all 12 checks, including `roster-sorted-by-state-with-header-chips` and `peek-number-key-answers-permission`.
- `packages/apexo`: `bun test test/tui test/cli/tui test/cli/cmd/tui test/parity` gives 111 pass, 0 fail.
- `packages/apexo`: the default `bun script/grok-slash-tui.mjs` flow still passes.
