# BUG-20261015-301: Intermittent local provider protocol response

- Scope: native legacy Memory focused fixture.
- Observed: one run of the captured-plan test failed before its Memory assertions with HTTP 400 and `Client sent an HTTP request to an HTTPS server.` Other tests in that run passed.
- Expected: the local fixture provider accepts its configured HTTP request and returns the queued completion.
- Reproduction: not established; one observed run only.
- Root cause: unknown. No evidence establishes a product Memory failure or a dependency identity failure.
- Fix: none claimed. A diagnostic captures the actual fixture URL and requests on error.
- Verification: an isolated rerun passed 1 test / 6 assertions, and subsequent complete focused runs passed 8 tests / 45 assertions. Passing reruns do not establish the root cause or prove this symptom fixed.
