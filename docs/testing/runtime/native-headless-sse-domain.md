# BUG-20261015-245: Headless output decoded global notifications as Session events

- Status: verified in private source tests and real native local CLI.
- Scope: native headless output adapter.

The initial local CLI invocation received the normal server.connected notification from the global native SSE stream. Passing it to the strict Session event schema threw instead of rendering the input receipt. The adapter now ignores notifications outside the session.next domain before invoking the canonical decoder and projector. Matching Session payloads remain strictly validated; the correction does not cast unknown events or weaken their schema.

`bun test test/cli/native-headless-output.test.ts` initially passed three tests and eleven assertions; after the separate message-identity regression was added, it passed four tests and twelve assertions, including an unrelated server notification, malformed Session rejection, exact input attribution and replay deduplication. Actual local plain, JSON and streaming JSON invocations each completed with one provider request. Shared/packaged acceptance remains separate.

Shared integration verification: fresh compiled local headless15/20, compiled file handling7/4 and rebuilt mixed Desktop17/22 pass; compiled startup cancellation3/0, active races3/3 and pre-start rejection7/0 also pass. Refreshed shared Core and Apexo package typechecks pass. Commands and exact evidence boundaries are retained in [the shared headless checkpoint](../../native-headless-cli.md#shared-integration-checkpoint); these checks do not replace final repository gates.
