# BUG-20261015-139: Storage fixture widened response bytes beyond BodyInit

- **Scope:** Native media-options real HTTP fixture; test authoring only.
- **Observed:** Apexo `bun typecheck` reported TS2345 when `Map<string, Uint8Array>` supplied its stored value to `Response`. The inferred byte-array buffer was `ArrayBufferLike`, which can include a shared buffer and is not the accepted response body type. Four runtime cases / 53 assertions had passed; those results did not establish type correctness.
- **Expected:** Store and return the actual request bytes with their precise supported buffer type, without a cast or weakening assertions.
- **Root cause:** The map annotation unnecessarily widened `request.arrayBuffer()` into an unconstrained typed array.
- **Fix:** Store `ArrayBuffer` directly from the real PUT request and pass that buffer to the real GET response. Exact saved-byte and upload/download checks remain unchanged.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the earlier `v2-media-options.e2e.test.ts` map.
- **Verification:** Apexo package typechecking passed after the buffer and separately recorded async-narrowing corrections. The subsequent native media regression suite passed 25 tests / 205 assertions before the additional malformed-configuration regression was introduced.
- **Occurrences:** One authoring episode; no recurring constraint.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
