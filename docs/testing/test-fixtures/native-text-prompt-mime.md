# BUG-20261015-270: Text fixture supplied an inferred prompt field

- Status: corrected; shared runtime assertions and refreshed Core/Apexo types pass.
- Scope: the native text-attachment runtime fixture's canonical `SessionV2.prompt` call.

The Apexo package typecheck reported TS2353 because a new inline file argument supplied `mime`. The public native prompt input accepts URI, name, description and source information; admission infers MIME itself. A projected FileAttachment contains MIME, but that does not make it a caller-owned prompt field.

The fixture now supplies only the canonical URI at admission and checks the resulting stored attachment separately. The public API is unchanged and no cast or schema widening is used. This was one fixture-authoring episode; the runtime converter failure remains BUG-20261015-257.

Verification uses `bun typecheck` from `packages/apexo` and the actual native text-attachment runtime test. The final Apexo package typecheck passed, and the actual native runtime case passed after removing the extra field. An independent pre-existing HTTP timeout in the larger combined run is recorded as BUG-20261015-273.

The shared four-file converter/runtime/headless/side-question command documented in [the CLI verification checkpoint](../../native-headless-cli.md#shared-integration-checkpoint) passed 22 tests / 178 assertions after integration. The shared all-workspace typecheck checkpoint predates this amendment; refreshed Core and Apexo package typechecks now also pass.
