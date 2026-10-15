# Native Memory search output schema used a count for skipped paths

- **Bug ID:** BUG-20261015-144
- **Status:** Fixed and verified in the private draft.
- **Scope:** Canonical native `memory_search` tool output.
- **Observed:** Core typechecking rejected the executor because MemorySearch returns `skipped: string[]`, while the new tool schema declared a number.
- **Expected:** The tool validates and returns the actual domain output, including skipped paths.
- **Cause:** The adapter's handwritten output schema described a count rather than the existing result's array.
- **Fix:** Declare `skipped` as an array of strings. Do not change the search service or cast away its result type.
- **Verification:** Core package typecheck passed after correction. Real native service search/get settlement and both HTTP native transcript cases subsequently passed. This is one authoring episode, independent of the missing runner failure-union member.

## Shared integration verification

The shared eleven-file Memory/terminal gate passed 96 tests / 371 assertions, including the six-file Memory coverage; all 21 workspace typechecks passed. Shared source CLI and freshly rebuilt Desktop each passed four checks / three provider requests. The five native Memory HTTP inventory scenarios also passed. The separate Memory-context timing observation remains unresolved and is not attributed to this repair.
