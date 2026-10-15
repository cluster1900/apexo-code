# BUG-20261015-199: Scheduler DELETE endpoint used an unavailable constructor

- Status: Fixed in the private Scheduler draft; shared integration is pending.
- Scope: Native Scheduler Protocol leaf and Server type validation.
- Occurrences: One authoring episode.
- Observed: Server `bun typecheck` reported TS2339 because `HttpApiEndpoint.del` does not exist in the pinned Effect API. The missing endpoint also produced a downstream unhandled-endpoint diagnostic.
- Expected: A bodyless DELETE endpoint constructed with the installed API.
- Reproduction: Typecheck Server with the initial Scheduler Protocol leaf.
- Root cause: The draft assumed a constructor shorthand instead of checking the pinned HttpApiEndpoint contract.
- Fix: Use `HttpApiEndpoint.delete`. No response or operation-identifier change was needed.
- Verification: Corrected Server `bun typecheck` passed. Real private CLI acceptance passed four checks / six provider calls, including native schedule deletion and an idempotent repeated DELETE. POST controls also remain bodyless.
