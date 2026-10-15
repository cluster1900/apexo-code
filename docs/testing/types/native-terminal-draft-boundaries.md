# BUG-20261015-136: Native terminal draft type boundaries

- **Scope:** Off-tree native terminal transport/view authoring; no shipped runtime failure is claimed.
- **Observed:** The initial TUI package typecheck reported three errors: passing a Schema encoder directly to Array.map supplied an index where ParseOptions is expected; a string-prefix discriminator did not establish assistantMessageID on the full tool/shell union; and an optional terminal directory was passed to required Location.Ref.directory.
- **Expected:** Typed canonical encoding, real discriminated fields and an actual directory before native creation. No casts, guessed workspace or compatibility fallback.
- **Fix:** Use an explicit one-argument encoding callback, check the required assistant identity field, and reject native creation without an explicit terminal or input Location. Read-only server queries retain their API-supported optional Location query.
- **Verification:** In packages/tui, `bun typecheck` passed after the typed fixes. In packages/apexo, `bun test test/tui/native-session-view.test.ts` passed 3 tests / 16 assertions through the real package export, canonical wire decoder and Core in-memory projector. The final two package typechecks passed after consumer integration; the final five-file gate passed 60 tests / 142 assertions. Real mini/fullscreen acceptance is detailed in the native terminal feature document.
- **Further diagnostics in the same draft:** Consumer wiring also exposed the actual permission reply field, optional Question answers, mandatory event ID/Session/time fields, a missing direct Schema dependency, Project.Current versus Location fields, the native step event discriminator, and the footer agent label type. These were corrected against canonical contracts without casts or relaxed decoding.
- **Occurrences:** One draft construction episode with the separate diagnostics listed above. It is not a recurrence claim or a production authorization repair.

## Shared integration verification

The integrated eleven-file Memory/terminal gate passed 96 tests / 371 assertions, and all 21 workspace typechecks passed. The actual shared mini/fullscreen matrix passed fresh creation, Plan, reconnect, permission, Stop, media paths, managed-child viewing, Tasks management and compatibility regression. The two initial permission-fixture backend startup timeouts remain a separate unresolved investigation (BUG163); unchanged single-mode reruns passed. All owned runs were reaped.
