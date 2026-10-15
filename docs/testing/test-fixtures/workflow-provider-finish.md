# BUG-20261014-061: Workflow provider fixture omitted its terminal event

- Scope: Native Workflow end-to-end provider fixture.
- Observed: The first planner streamed valid JSON but no completed message metadata or usage; Workflow correctly rejected the unfinished child.
- Expected: Successful fixture replies emit a stop event and usage, matching real provider transport.
- Reproduction: Run `bun test test/e2e/v2-workflow.e2e.test.ts` from `packages/apexo` with reply().text(...).usage(...).item().
- Root cause: Reply.item only appends finish and usage after stop() or toolCalls(). The new text response helper omitted stop(). An initial suspicion that native projected metadata was inherently absent was disproved by tracing the stream: only step-start/text-start/text-delta arrived.
- Fix: Explicitly finish text fixture replies with stop(). The added native Workflow transport receipt observer remains useful for actual usage accounting and unfinished-stream rejection, without additional provider calls.
- Verification: Corrected native end-to-end run passed one test and nine assertions, including six research children and one Rhai child. No production provider failure is inferred from this fixture error.
- Occurrences: One fixture-construction mistake; no recurrence count added.
