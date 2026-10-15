# Native Session Compaction

Manual compaction is an explicit native Session control. `SessionV2.compact`
validates the Session and delegates to the process-local `SessionExecution`
coordinator. The coordinator serializes it with the Session's provider turns,
other controls, and interruption. It does not admit or promote a prompt, consume
an agent turn, or run an ordinary assistant continuation.

An empty projected history is a no-op. A nonempty history is summarized through
one native model stream using the Session's selected model and the existing
`SessionCompaction` prompt format. Manual summaries include the current projected
history and carry forward the previous summary. Automatic compaction retains its
configured recent-context policy. The completed event uses reason `manual`.

A nonblank text result alone is insufficient: a successful `finish` receipt with
reason `stop` is required. Provider failure, an incomplete stream, a filtered or
truncated result, or an unusable context limit returns a typed compaction failure.
No completed summary replaces projected history in those cases. Interruption
waits for owned work to settle and does not publish a completed summary.

At provider boundaries, controls inherit the current Goal attempt and usage
observer. Each summary stream bills its own Goal transport receipt. Automatic
and overflow summaries inside Workflow children also feed the Workflow role's
receipt observer. An active Goal without a live attempt rejects manual compaction
instead of starting unaccounted model work.

Manual compaction of managed Goal and Workflow child Sessions is unavailable,
including after their owning execution closes. Their parent owns their execution
and result lifecycle. In particular, `packages/core/src/workflow/runtime.ts`
awaits `children.run`, then reads the final structured assistant reply from
`sessions.context`; a manual summary after the last provider turn would remove
that result before the parent consumes it. Goal review children additionally
hold scoped report-file capabilities, which `packages/core/src/session/goal-runner.ts`
finishes after the child drain. Manual compaction is supported on the parent
Session at a safe provider boundary. Automatic compaction remains available
inside children because its runner immediately rebuilds context and continues
the provider turn before result consumption.

Verification is tracked in
[the native Session controls bug record](testing/runtime/native-session-controls-unavailable.md).
The HTTP acceptance cases are in
`packages/apexo/test/e2e/v2-compaction.e2e.test.ts`,
`packages/apexo/test/e2e/v2-goal.e2e.test.ts`, and
`packages/apexo/test/e2e/v2-workflow.e2e.test.ts`.


## Production backend verification

The shared CLI/Desktop acceptance script passed five checks with four provider
requests in each runtime, including the freshly built packaged Electron backend.
It covers empty/admit-only history, one explicit summary without queue promotion,
provider failure, interruption and missing Session behavior. The combined native
integration gate passed 16 tests and 159 assertions, including Goal budget and
Workflow receipt accounting. These results verify native backend behavior; they
do not establish complete Desktop UI or cross-platform acceptance.

## Installed Grok comparison

The isolated installed Grok 1.0.52 runtime passed three comparison checks through
ACP. It recognized `/compact` as a command, sent an explicit summarization
request, and returned a typed `compact_failed` error for the deliberate HTTP 400.
Five requests included the seed assistant and an ancillary initial title in
addition to three compaction attempts (empty, nonempty, and deliberate failure).
The reference source checkout was at `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.

The reference also summarizes initial system context before any user message;
Apexo deliberately treats empty projected conversation history as a no-op.
This observed difference is recorded rather than presented as identical behavior.
The reference's minimum-summary-size guard is also not adopted as a claim of
Apexo parity: Apexo requires nonblank text and a successful finish receipt.
Both systems preserve a distinct explicit command rather than treating the
command text as a normal user request. The reference process is used only in
`grok-session-compact-official.mjs`; no native product feature invokes it.
