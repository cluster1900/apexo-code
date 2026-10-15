# Background Task fixture connection reset before Session creation

- **Bug ID:** BUG-20261015-106
- **Status:** Investigating; no established cause or product repair.
- **Scope:** Coherent private native Task regression on macOS, Bun 1.3.14.
- **Observed episode:** 1.

A 33-test run passed 32 tests and failed its first background-idle case after 41 ms. The initial POST to loopback `/api/session` failed with ECONNRESET: “The socket connection was closed unexpectedly.” No Task or provider work had begun for that scenario. Existing authority, receipt, Goal accounting and the remaining seven background cases passed. The native CLI subsequently passed eight checks with 32 provider calls on the same source checkpoint.

The fixture uses Effect `NodeHttpServer.layerTest`, whose implementation binds an ephemeral Node listener and provides a Fetch client with `keepalive: false`. This identifies the configured client/layer, not the actual peer of the failed connection. The failed log retained its request URL but not socket ownership or connection-reuse evidence. Old-connection reuse is only a hypothesis; no cause is assigned from an unchanged pass.

A bounded diagnostic-only middleware probe preserves that same layer and records listener PID/address, per-request local/remote socket addresses and failure response metadata. No product retry or error-semantic change is proposed. This reset is distinct from the SOAP-shaped HTTP response in [BUG-20261015-104](task-background-soap-response.md); their causes are not established as identical.

A bounded diagnostic-only run retained the original NodeHttpServer test layer and added listener/socket observations. It passed eight tests / 66 assertions without reproducing either reset or SOAP. Its eight owned listeners observed 78 requests at their exact bound ports, with loopback peer/local addresses and 78 distinct client socket tuples. That successful run observed no reuse, but cannot establish what happened in the failing run. All owned processes exited and were reaped. The first probe used the unavailable Effect 3 `tapErrorCause` API and failed before issuing requests; it was corrected to pinned Effect 4 `tapCause`. That probe-authoring error is not another connection-reset occurrence or a production fix.
