# BUG-20261015-354: Native Plan approval wait timed out in the aggregate gate

- **Status:** Investigating; no runtime fix or confirmed root cause.
- **Scope:** Native Plan end-to-end approval, shared full unit gate.
- **Observed:** The full unit gate finished with 4498 passes, 19 skips, one todo and one failure across 448 files. `native Plan switches at the batch boundary and requires an explicit answer` failed waiting ten seconds for its approval question; the case duration was 11,037 ms. The complete process exited 1 after 23 minutes 4.889 seconds.
- **Expected:** The second provider turn writes its plan and requests exit in the same tool batch; the approval question must show the written plan and wait for an explicit answer before returning to the build agent.
- **Reproduction:** From the repository root, use pinned Bun 1.3.14 and run `GITHUB_ACTIONS=false bun turbo test --concurrency=2`. The failure occurred after the Task wake, Stop cancellation, Workflow agent selection and Subagent Hooks integration, before the later Hook-source integration.
- **Root cause:** Unknown. The aggregate did not capture the provider count, selected agent or durable transcript at the timeout. Host activity or a slow poll is not a demonstrated cause. This is not counted as another occurrence of the previously corrected malformed multi-tool SSE fixture.
- **Change:** Add failure-only diagnostics for provider calls, selected agent, current questions and chronological messages. Keep the existing ten-second readiness deadline, assertions and product behavior unchanged.
- **Verification:** The unchanged isolated `bun test test/e2e/v2-plan.e2e.test.ts` passed 13 tests / 136 assertions in 25.11 seconds; the previously failing case took 2122.53 ms. With diagnostics added, the affected case passes one test / 18 assertions and Apexo typechecking passes. This does not prove a repair. No recurring constraint is justified by this single unresolved observation.

The apparent pause in the outer aggregate log was buffered reporting: the original handle completed and retained the actual failed result. An unchanged isolated OAuth file passed five tests / 29 assertions; no OAuth defect was established.
