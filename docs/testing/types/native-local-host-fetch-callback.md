# BUG-20261015-177: Native host fetch adapter used as a Bun server callback

- **Scope:** Private native-local fullscreen worker authoring, one type failure episode.
- **Observed:** Apexo typechecking reported TS2322: the adapter's optional second `RequestInit` argument was incompatible with Bun.serve's required second `Server` argument.
- **Expected:** The listener forwards only the incoming Request into the fetch-compatible native host adapter.
- **Cause:** The draft assigned a standard fetch-shaped function directly to a server callback with a different invocation contract. Its second argument must not be interpreted as request initialization.
- **Fix:** Use the explicit request-only wrapper `(request) => owned.fetch(request)`. No casts or relaxed function types.
- **Verification:** Initial `bun typecheck` from `packages/apexo` exited 2 with this single diagnostic. The corrective check completed with exit zero.

The corrective `bun typecheck` from `packages/apexo` completed with exit zero after the request-only wrapper and graceful terminal ownership changes. Both source mini and fullscreen passed real Question/second-prompt checks, and the authenticated fullscreen worker passed HTTP/SSE and joined-listener teardown checks.
