# BUG-20261014-103: Late workflow settlement overwrote explicit control state

- Scope: Native Workflow engine terminal transitions.
- Observed: A real Store and Deferred regression committed paused while the script was settling, then released the script. The engine overwrote paused with completed.
- Expected: Once pause or cancellation commits, a late script success or failure preserves that control state.
- Reproduction: Run the settling-script regression in test/workflow/engine.test.ts. Hold script completion, commit paused, release completion, and inspect durable status.
- Root cause: Script outcome and failure paths updated terminal status without checking the latest durable status inside the serialized Store mutation. The declarative completion path also checked status before, rather than within, its final mutation.
- Fix: Control.stop also checks eligibility inside the serialized mutation, preserving a run that completed before the stop mutation. Check the latest status within each serialized mutation. Pending execution cannot revive a stopped run; script success, declarative completion, and failure can only settle a running run.
- Verification: Before the fix, one targeted test failed with expected paused and received completed. After the fix, the focused Workflow suite passed 10 tests and 44 assertions, including late success and failure against both pause and cancellation; Core typecheck passed. The production CLI lifecycle rerun passed five scenarios with 11 provider calls; the rebuilt Desktop rerun also passed five scenarios with 11 provider calls. This is a deterministic state transition failure, unrelated to provider timing.
- Occurrences: One reproduced transition bug. The success and error cases are coverage of the same root cause.
