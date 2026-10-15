# BUG-20261015-358: Native Shell configuration provider readiness timeout

- **Status:** Investigating; no confirmed cause or runtime repair.
- **Scope:** Native Shell host settings and combined Workflow/Shell regression.
- **Observed:** The combined 23-file gate passed 65 tests and failed `configured native Shell zero caps promotes the original process`, with 647 assertions overall. The failed case took 6767.30 ms and reported a five-second `Effect.TimeoutError`; the original output did not identify whether the initial tool return or completion delivery was waiting.
- **Expected:** Zero host wait caps allow immediate promotion of the original process. The tool return and later completion each reach the provider, preserving process identity and the ordinary process lifetime.
- **Reproduction:** With pinned Bun 1.3.14, run `bun test test/v2/shell-host-config.test.ts` from `packages/apexo`, or include it in the Workflow/Shell regression gate. The observed failure occurred during the combined gate, not the subsequent isolated run.
- **Root cause:** Unknown. Concurrent host activity is context only, not a demonstrated cause. A passing isolated rerun is not a repair.
- **Change:** Add failure-only diagnostics naming the initial return versus completion phase, provider call count, process records and Session messages. Preserve both five-second deadlines and every assertion; product behavior is unchanged.
- **Verification:** The unchanged isolated affected case passed one test / 11 assertions in 447.04 ms. With diagnostics and the subsequent Shell prefix/output integration, the seven-file Shell gate passes 33 tests / 311 assertions; the affected case takes 225.84 ms. The refreshed aggregate remains pending. These passes do not establish a timing repair; the original failed result remains part of the evidence.
- **Occurrences:** One unresolved combined-gate observation. No recurring constraint is justified.
