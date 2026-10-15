# Process ID annotation discarded its constructor

- **Bug ID:** BUG-20261015-121
- **Scope:** Private native Shell receipt schema authoring; not a shipped defect.
- **Status:** Corrected and verified in the isolated source checkpoint.
- **Independent occurrences:** One.

The first real process-store admission test failed with `TypeError: SessionProcess.ID.create is not a function` before a receipt or OS process could start (zero passed, one failed). The schema initially applied `statics(...)` to attach the canonical `create` method, then called `.annotate(...)`. Annotation returned a new schema value without that assigned method.

Annotation now precedes branding and `statics(...)`, so the final canonical exported ID retains its constructor and schema identity. The actual store test exercises the factory, branded decode, exact invocation retry and durable admission; it does not replace the constructor with a cast or a fixture-generated raw string. This differs from BUG014, where a fixture called a factory the PartID API never provided.

Verification commands, from `packages/apexo`: `bun test test/v2/process-store.test.ts` and `bun typecheck`. Core and Schema typechecks run from their own package directories. Results are appended after corrected runs.

Corrected verification: the actual receipt test passed one test / 45 assertions. Schema, Core and Apexo package typechecks each passed. The additional bounded collector passed three tests / seven assertions. These results validate this draft boundary, not the later tool/API integration or shared aggregate gates.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
