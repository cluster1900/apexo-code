# RULE-20261015-009: Keep native HTTP fixtures out of DOM globals

- **Status:** Active after integration.
- **Scope:** Real HTTP fixtures under the App HappyDOM preload.
- **MUST:** Use native-compatible HTTP response construction and matching fetch/abort primitives, or isolate the transport fixture in a native child process.
- **NEVER:** Return HappyDOM `Response` objects from `Bun.serve`, replace process globals to make the test pass, or infer transport success from a fallback result.
- **Verification:** Assert the actual request/response and cancellation behavior, close owned listeners, and join owned child processes. Preserve the App's ordinary preload.
- **Source:** [BUG-20261014-124](../testing/test-fixtures/protocol-health-dom-response.md), four independent fixture-authoring episodes.

This rule concerns the demonstrated native/DOM Response identity mismatch. It does not attribute unrelated request timeouts or abort failures to that cause without evidence.
