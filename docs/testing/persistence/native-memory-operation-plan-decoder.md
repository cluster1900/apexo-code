# BUG-20261015-253: Overlapping plan codecs discarded durable operation evidence

- **Scope:** Private Stage 2 Memory operation receipt decoder; Stage 1 capture receipts remain supported.
- **Observed:** A real migration completed, but its exact retry failed. SQLite retained the full migration proof while the decoded receipt contained only the common capture-plan fields. The smaller capture Struct matched the overlapping union first and discarded Dream/migration fields.
- **Expected:** Reload and retry retain the exact recorded operation kind's authority and preview. No model or migration replay should follow an exact retry.
- **Fix:** Decode the outer private receipt first, then select the exact plan codec from its closed `kind`, rejecting excess/invalid fields. The TypeScript plan union remains internal; the untrusted stored plan is decoded, not cast.
- **Verification:** The native migration exact-retry regression failed before the change and passed afterward. The CLI Dream/migration acceptance passed six checks, including restart and exact settled retry, with two ordinary, two extraction and three Dream calls. `bun typecheck` in Core and Apexo passed. Run `bun test test/v2/memory-dream-native.test.ts` and `bun script/grok-memory-dream-native.mjs cli` from `packages/apexo`.
