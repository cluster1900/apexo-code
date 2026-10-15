# BUG-20261014-234: LSP descendant assertion races operating-system reaping

- Type: Test fixture / process lifecycle
- Scope: Native LSP transport and Core acceptance fixtures
- Status: Verified in focused transport and native Core tests.

The initial client cancellation check asserted `kill(pid, 0)` failure immediately
after its direct language-server child closed. The owned process group had been
signaled, but an orphan descendant was still briefly visible before operating-
system reaping. A follow-up process inspection confirmed that both recorded
PIDs were gone; this was not inferred merely from rerunning the test.

The fixture now polls each recorded PID with a bounded one-second deadline,
then asserts that it no longer exists. It does not weaken the final requirement
or ignore a living child. The transport still performs process-group termination
and waits for the direct child's close event. The corrected focused run passed
two tests and six assertions, including a real canceled JSON-RPC request and
both recorded process IDs disappearing. The subsequently integrated native Core suite also asserts bounded disappearance of every recorded child and descendant after cancellation, reload, and Location teardown. Final combined native LSP, bundle-runtime, and plugin-store coverage passed 16 tests and 147 assertions. Real clangd CLI and packaged Desktop workflows each passed 12 scenarios; these are execution/activation checks, not substitutes for the recorded descendant assertions.
