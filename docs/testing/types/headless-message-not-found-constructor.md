# BUG-20261015-226: Input API omitted required missing-message error identifiers

- **Scope:** Private Server input-execution handlers.
- **Observed:** Apexo package typecheck reported TS2739: MessageNotFoundError construction supplied a message but omitted sessionID and messageID.
- **Expected:** The existing public error contract retains both exact request identifiers.
- **Root cause:** The new shared error mapper discarded its request target before constructing the canonical error.
- **Correction:** Bind the validated target in the mapper and provide both identifiers. Do not weaken the error schema or cast its type.
- **Verification:** Core and Apexo package typechecks passed; actual pure-native and mixed HTTP routes returned 404 for an unknown input. The combined runtime gate passed 11 tests / 188 assertions before the final replay refinement.
- **Occurrences:** One authoring episode.
