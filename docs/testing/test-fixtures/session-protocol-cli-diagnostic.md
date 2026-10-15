# BUG-20261015-170: Invalid transport choice fixture assumed unprinted diagnostic wording

- **Scope:** New explicit-transport CLI rejection fixture; one authoring episode.
- **Observed:** Invalid choice exited nonzero and printed the supported choices/help, but the fixture expected the literal `Invalid values`, which the actual CLI did not print.
- **Expected:** Assert the real CLI contract together with rejection and absence of side effects.
- **Cause:** The test assumed a generic yargs diagnostic instead of inspecting Apexo's final CLI presentation.
- **Fix:** Assert nonzero exit and the actual `auto`, `native`, `compatibility` choices. Retain checks that the invocation created no Session and called no provider. Other cases retain their specific native-headless and missing-attach diagnostics.
- **Verification:** `node --check script/grok-session-protocol-errors.mjs` and `bun script/grok-session-protocol-errors.mjs` from `packages/apexo` passed. Four rejection cases made zero provider calls and created zero Sessions. No production behavior or rejection assertion was relaxed.
