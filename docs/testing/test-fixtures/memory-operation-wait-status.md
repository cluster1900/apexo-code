# BUG-20261015-225: Memory fixture expected JSON success from a bodyless wait

- **Scope:** The new native Memory lifecycle CLI acceptance script; no product defect.
- **Observed:** The ordinary turn completed, but the fixture rejected the native Session wait response because it expected HTTP 200 and received 204.
- **Cause:** The new request helper's default success status was applied to a bodyless endpoint whose established contract is 204 with no payload.
- **Fix:** Explicitly expect 204 for both Session wait calls. Continue sending no request body and preserve the operation assertions.
- **Verification:** `node --check packages/apexo/script/grok-memory-native-lifecycle.mjs` passed; `bun script/grok-memory-native-lifecycle.mjs cli` from `packages/apexo` passed five checks with two ordinary and three extraction requests. The earlier failure is not a wait/coordinator defect or a recurrence of an unrelated polling-helper mismatch.

## Independent Workflow cancelled-source fixture occurrence

The Workflow resume end-to-end fixture initially expected HTTP 200 from the native Task cancel endpoint and received its documented bodyless 204. The request had correctly omitted a body. The corrected expectation preserves the actual cancellation and continuation assertions: a cancelled Task source resumes into a fresh Workflow child with durable tool history and unchanged Task ownership. The focused resume gate passed both end-to-end tests after correction. This is a second independently authored bodyless-status assumption, not a product cancellation defect.
