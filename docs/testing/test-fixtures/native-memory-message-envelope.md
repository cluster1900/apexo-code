# BUG-20261015-263: Native Dream fixture confused Core messages with the HTTP envelope

- **Scope:** Private native Dream runtime fixture, not product message handling.
- **Observed:** The first real Dream test reached eight successful assertions, then failed its final transcript assertion. Apexo typechecking reported TS2339 for `.data` on `Message[]`.
- **Cause:** The fixture used the HTTP `{data}` response shape on the in-process Core `SessionV2.messages` result, which is already the message array.
- **Fix:** Assert the canonical Core array directly; no product API, decoder or assertion scope changed.
- **Verification:** The corrected real native suite passed nine tests / 53 assertions, and Apexo package typechecking passed. Run `bun test test/v2/memory-dream-native.test.ts` and `bun typecheck` from `packages/apexo`. The runtime and compiler failures are evidence of one fixture-authoring episode, not two recurrences.
