# Native Memory fixtures omitted the canonical tool-call discriminator

- **Bug ID:** BUG-20261015-151
- **Status:** Corrected and verified.
- **Scope:** Native Memory service tests using ToolRegistry settlement.
- **Observed:** Apexo typechecking rejected several fixture call objects because the required `type` field was missing.
- **Expected:** Construct the real canonical `ToolCall` input, including `type: "tool-call"`.
- **Cause:** The author supplied name, id and input but omitted the tagged-union discriminator. Multiple affected call sites are one fixture-authoring episode.
- **Fix:** Add the canonical discriminator at each fixture call; preserve the production contract and real registry settlement.
- **Verification:** The corrected native Memory service test file initially passed ten tests / 49 assertions; the final six-file scoped gate passed 36 tests / 229 assertions. The final composed Apexo package typecheck also passed.

## Shared integration verification

The shared eleven-file Memory/terminal gate passed 96 tests / 371 assertions, including the six-file Memory coverage; all 21 workspace typechecks passed. Shared source CLI and freshly rebuilt Desktop each passed four checks / three provider requests. The five native Memory HTTP inventory scenarios also passed. The separate Memory-context timing observation remains unresolved and is not attributed to this repair.
