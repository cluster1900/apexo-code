# Shell receipt exact retry depended on object property order

- **Bug ID:** BUG-20261015-122
- **Scope:** Private native Shell process receipt store; not a shipped defect.
- **Status:** Corrected and verified in the isolated source checkpoint.
- **Independent occurrences:** One.

After fixing the separate ID-constructor defect, the real receipt test rejected an unchanged invocation as `Shell invocation was reused with different arguments`. The schema decoder rebuilt the persisted request in schema field order, while the input object had an equivalent different property order. Comparing JSON strings therefore treated structural equality as a conflict. The combined run had seven passing observer tests and one failed receipt test, with 35 assertions.

The store now compares the canonical authority/execution fields explicitly. Current fields are required, so optional missing/undefined equivalence is not involved. The test checks an actual persisted/decoded reordered retry and independently rejects changes to agent, command, directory, shell, description, wait budget and process timeout. Exact Session creation identity and process owner checks remain independent of argument equality.

From `packages/apexo`: `bun test test/v2/process-store.test.ts`, followed by package typechecks. Corrected results are appended after the run; no passing result is inferred from this source change.

Corrected verification: the actual receipt test passed one test / 45 assertions. Schema, Core and Apexo package typechecks each passed. The additional bounded collector passed three tests / seven assertions. These results validate this draft boundary, not the later tool/API integration or shared aggregate gates.

Shared integration verification: all 21 workspace typechecks passed, and the combined native Shell/media/Plan suite passed 68 tests / 623 assertions. Shared CLI and freshly rebuilt Desktop passed Shell nine checks / 26 calls each and media-options five checks / eight calls each. These are scoped gates; the earlier full-unit checkpoint is not claimed for the later integration.
