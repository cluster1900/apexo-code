# Native Session Wait and Explicit Compaction Are Unavailable

- **Bug ID:** BUG-20261014-137
- **Type:** Runtime capability gap
- **Scope:** Native Session API (`wait`, `compact`)
- **Status:** Native manual compaction, CLI, packaged Desktop and installed reference verified; wait CLI and packaged Desktop verified
- **Independent occurrences:** 1

## Observed and expected behavior

The native Memory acceptance fixture called `POST /api/session/:sessionID/wait`
and received HTTP 503 with `Session wait is not available yet`. Inspection also
confirmed the public explicit compaction route delegates to an unavailable
operation. Waiting should join the currently owned drain without starting model
work; explicit compaction should serialize through the native executor.

## Reproduction and root cause

Create and prompt a native Session, then POST without a body to its `/wait`
route. `SessionV2.wait` and `SessionV2.compact` deliberately return
`OperationUnavailableError`; their Server handlers map it to HTTP 503. These
are unimplemented paths, not provider failures or transient test timing.

## Current handling and remaining work

The Memory fixture now observes native active execution and completed messages,
and exercises real automatic compaction with a bounded local-provider workload.
That change does **not** implement either unavailable API. The control-lane
implementation, cancellation tests and direct API acceptance remain required.

## Wait implementation checkpoint

Native wait now captures the existing process-local coordinator ownership chain and joins its settlement without calling resume, admitting prompts, or creating provider work. Idle wait is a no-op after validating Session existence. Server mapping preserves missing Session 404 and maps captured execution errors to the existing service-unavailable response. Explicit controls use the same coordinator ownership lane; runner boundaries flush queued actions before loading another provider request.

Production CLI wait acceptance passed four checks with one provider call: idle wait, admit-only input remaining unpromoted, joining held provider completion without a follow-up call, and missing Session 404. The focused coordinator and Workflow ownership suite passed 12 tests and 37 assertions. The combined native Session, Workflow, and control gate passed 31 tests and 144 assertions; Core and Apexo typechecks passed. Desktop wait acceptance awaits a rebuilt backend. Explicit compaction remains unavailable and is not claimed by these results. Additional control-settlement findings are recorded in BUG-20261014-132 and BUG-20261014-133.

## Manual compaction implementation checkpoint

The native runner now exposes a dedicated `compact` operation, routed through the
existing process-local control lane. It summarizes projected history without
promoting admitted input or running an assistant turn. Empty history is a no-op;
nonempty unusable or unfinished summaries fail with `Session.CompactionFailure`.
Completed summary publication requires a nonblank result and a successful `stop`
finish receipt. The previous implementation accepted text from an incomplete
stream; such a stream no longer replaces projected history.

Controls at provider boundaries execute under the same Goal attempt and observer
as the surrounding turn, including the boundary after the final provider reply.
Summary streams also feed Workflow receipt accounting. An active Goal without a
live attempt fails closed. Managed child Sessions reject manual compaction to
preserve the parent's result consumption and scoped capability lifecycle; see
[the native compaction contract](../../native-session-compaction.md).

Verification is in progress. Core typecheck passed after the initial implementation.
The coordinator and native-deletion regressions passed 12 tests
in the first combined run; the new HTTP test initially used an unavailable
`/resume` path and was corrected to retry the admitted prompt with `resume: true`.
Subsequent mixed HTTP runs exposed an independent `InstanceRef not provided`
defect in native event callbacks after the hook snapshot changes. Those failing
runs do not verify manual compaction or establish a compaction root cause.
Dedicated HTTP, Goal, Workflow, CLI, Desktop, and official-reference acceptance
remain pending at this checkpoint.


## Native verification

With the independent hook callback context defect corrected, the combined native
Session acceptance gate passed **16 tests and 159 assertions** on pinned Bun
1.3.14:

```sh
# Run from packages/apexo
bun test test/e2e/v2-compaction.e2e.test.ts test/e2e/v2-goal.e2e.test.ts test/e2e/v2-workflow.e2e.test.ts test/e2e/v2-session.e2e.test.ts test/session/control-coordinator.test.ts test/session/native-delete.test.ts
bun test test/server/httpapi-session.test.ts -t 'settles idle v2 controls'
# Run from packages/core
bun typecheck
```

The focused idle HTTP contract test passed **1 test and 3 assertions**; Core
typecheck passed. Manual compaction uses exactly one summary request, leaves
admit-only and queued prompts unpromoted, requires a successful finish receipt,
preserves history on incomplete or filtered output, and settles interruption
without publishing a summary. The Goal completion scenario accounts for seven
summary tokens (21 total). The explicit budget scenario stops an eight-token Goal
at 13 actual tokens after its summary receipt, with no evaluator request. The
Workflow scenario accounts for seven automatic summary tokens plus three final
reply tokens. Live and historical managed-child manual requests return 503 while
the owner still receives its structured result.

Fixture authoring corrections are separately recorded as BUG-20261014-145,
BUG-20261014-146, and BUG-20261014-147. They are not additional occurrences of
this product capability gap. CLI, packaged Desktop, and installed reference
scripts are prepared but have not yet run for manual compaction.


## Installed reference verification

`bun run script/grok-session-compact-official.mjs` passed three checks against
Grok 1.0.52 with five local requests. Actual request bodies identify empty and
nonempty explicit compaction prompts; deliberate HTTP 400 returns
`compact_failed`. The count includes one independent initial title request.
Unlike Apexo's empty projected-history no-op, the reference summarizes initial
system context. See the [contract comparison](../../native-session-compaction.md)
and fixture corrections BUG-20261014-148/149. These reference results do not
substitute for Apexo's native tests. CLI and packaged Desktop acceptance remain
pending until the shared build is available.

## Production CLI verification

From `packages/apexo`, pinned Bun 1.3.14,
`bun run script/grok-session-compact.mjs cli` passed **five checks with four
provider calls** against the actual CLI server. It verifies empty/admit-only
no-op behavior, exactly one nonempty summary request without queue promotion,
provider-error preservation of history, interruption without completed summary
publication, and missing Session 404. The fixture-owned server and provider were
closed after the run. Packaged Desktop acceptance remains pending the shared
build.

## Production Desktop compaction verification

After the shared App and Desktop production build, from `packages/apexo` on
pinned Bun 1.3.14, `bun run script/grok-session-compact.mjs desktop` passed
**five checks with four provider calls** and exited successfully. It runs the
same explicit native API scenarios as the CLI fixture against the packaged
Electron backend: empty/admit-only no-op, one summary without queue promotion,
provider failure preserving history, interruption without summary publication,
and missing Session 404. The owned backend and provider were closed. Earlier
pending statements above are chronological checkpoints, superseded by this run.
These backend results do not claim complete Desktop UI or cross-platform parity.

## Production Desktop wait verification

`bun script/grok-session-wait.mjs desktop` from `packages/apexo` passed the same
four checks as CLI with one provider request after the shared production build:
idle wait, admit-only input remaining unpromoted, joining an active provider
completion without another turn, and missing Session 404. All owned processes
were closed. This supersedes the earlier pending Desktop wait checkpoint.
