# BUG-20261103-001: Nested `error.message` extraction in `ProviderError.parseAPICallError`

- Scope: `packages/apexo/src/provider/error.ts` and `packages/apexo/test/provider/error.test.ts`.
- Observed:
  - When `APICallError.message` matched `STATUS_CODES[e.statusCode]` (such as `"Bad Gateway"` for HTTP 502) and `e.responseBody` was a JSON object with a nested `error.message` field (`{"error":{"message":"Upstream gateway timeout"}}`), `ProviderError.parseAPICallError` returned `"Bad Gateway: {\"error\":{\"message\":\"Upstream gateway timeout\"}}"` instead of extracting the nested string message.
- Expected:
  - `ProviderError.parseAPICallError` must extract nested `body.error.message` as well as string-valued `body.error` and top-level `body.message`, formatting `"<HTTP status text>: <extracted message>"` while keeping status codes, retry decisions, and context-overflow classification unchanged.
- Reproduction:
  - Call `ProviderError.parseAPICallError` with an `APICallError` whose `statusCode` is `502`, `message` is `"Bad Gateway"`, and `responseBody` is `JSON.stringify({ error: { message: "Upstream gateway timeout" } })`.
- Root cause:
  - `message()` in `packages/apexo/src/provider/error.ts` evaluated `const errMsg = body.message || body.error || body.error?.message`. When `body.error` was an object, `body.error` was truthy and short-circuited before `body.error?.message`, causing `typeof errMsg === "string"` to fail and fall back to raw `e.responseBody`.
- Fix:
  - Evaluate `const errMsg = body.message || body.error?.message || body.error` in `packages/apexo/src/provider/error.ts` and add unit test coverage in `packages/apexo/test/provider/error.test.ts` for nested `error.message`, string-valued `error`, top-level `message`, and context-overflow classification.
- Verification:
  - Verified `bun test ./test/provider/error.test.ts ./test/session/retry.test.ts` and `bun typecheck` in `packages/apexo`.
- Occurrences: 1.
