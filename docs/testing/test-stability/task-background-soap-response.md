# Unexplained SOAP-shaped response in native background Task HTTP tests

- **Bug ID:** BUG-20261015-104
- **Status:** Investigating; no established cause or product repair.
- **Scope:** Two private fresh-process native background Task HTTP runs and a later shared full-suite Subagent Hook fixture on macOS with Bun 1.3.14.
- **Observed runs:** Three independently failing runs across one continuing investigation; the shared cause and response owner remain unknown. Repeated symptoms do not establish a recurring root-cause constraint.

## Observed and expected behavior

A POST to the fixture's loopback `/api/session` URL returned HTTP 500 instead of native JSON. The first retained request URL used `127.0.0.1:49196`; the response was not redirected. A subsequent failure retained an XML SOAP fault whose text included `No XML element tag` and WSUS namespaces. Task execution had not yet been reached for those requests. The runs respectively ended with 11 passes / 1 failure and 5 passes / 2 failures.

The expected response is the owned native HTTP listener's JSON Session response. The observed response shape alone does not establish which process served it or why it appeared.

## Missing provenance and investigation limits

The failing runs retained response status/body and the requested URL, but not a complete response-header snapshot, socket remote/local addresses, or a contemporaneous owned-listener PID-to-port record. The configured loopback URL is not proof of actual response ownership. No cause is assigned to host concurrency, proxies, port reuse, Bun, or the native application.

A diagnostic-only listener recorded PID, bound port and request socket addresses, but did not reproduce the SOAP response. Its normal seven-case run passed 7 tests / 57 assertions. Repetition in one process instead found the separately explained preload/XDG teardown error, [BUG-20261015-098](../test-fixtures/task-background-rerun-preload.md). Neither that fixture correction nor an unchanged passing rerun proves a SOAP repair. The later production-source four-file run passed 15 tests / 153 assertions; this is scoped acceptance, not closure of this investigation.

## Next reproduction evidence

On recurrence, preserve status, headers and body alongside the exact request URL, actual client remote address and the owned listener PID/bound port before cleanup. Keep diagnostic instrumentation private and avoid exposing credentials. Only then classify a cause and propose a repair. Do not merge this with an earlier HTML 501 or any unrelated timeout solely because the response was unexpected.

## Later shared aggregate observation

The frozen eight-capability checkpoint again received HTTP500 with the SOAP fault during `native Subagent hooks continue preserve ownership, aliases and provider budgets`. It failed in Session creation after100.05ms, before Task execution. The retained body matches the earlier WSUS-shaped response, but this run did not retain client socket provenance or the bound-listener identity. The failure is recorded here as another observation; it does not prove the earlier runs share a root cause. The full aggregate ends4553pass/8fail; only one failure is this SOAP observation. Failure-only logging now retains listener address, process ID, request URL, status and selected response headers in the Subagent fixture. Actual client socket provenance still requires a reproduced failure; no response owner is inferred from a configured URL. No fix or successful replacement aggregate is claimed.

The diagnostic-only combined Subagent/CLI rerun exits0 with22 tests/136 assertions in43.76s; all eight Subagent scenarios pass. No SOAP response recurred, so the response owner and cause remain unresolved.
