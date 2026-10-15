# BUG-20261015-105: Native Plan fixture used an incompatible polling helper contract

- **Status:** Corrected and verified in the isolated native Plan draft.
- **Scope:** New native Plan HTTP fixture; no production defect.
- **Observed:** The first run attempted to read an absent question immediately and failed after two assertions. The helper had been passed an array-producing Effect and a predicate where it expected a diagnostic string.
- **Expected:** Poll until the Effect produces a defined pending question result.
- **Cause:** The fixture assumed a predicate-based polling signature. The actual shared pollWithTimeout contract repeats only while its Effect returns undefined.
- **Fix:** Map an empty question list to undefined before passing it to the existing helper. Keep the real pending question and explicit-answer assertions.
- **Related construction corrections:** Early package typechecking also caught direct access to an unknown provider tools object and a nonexistent HttpClientRequest.del method. Decode the actual tools through Schema and use the existing delete request constructor. The added agent-switch scenario also initially expected HTTP 200 where the real existing endpoint declares 204; its status assertion now follows that contract. These are fixture authoring mistakes, not production fixes or independent recurring polling failures.
- **Reproduction:** Run `bun test test/e2e/v2-plan.e2e.test.ts` from `packages/apexo` with the original polling call.
- **Verification:** The final suite passed 11 tests and 107 assertions; Apexo package typechecking passed. The invalid two-tool provider response is separately recorded under BUG-20261015-094.

Shared integration verification: the combined native Plan and background Task approval suite passed 14 tests / 153 assertions; all 21 repository typecheck tasks passed. CLI and rebuilt Desktop recovery each passed 13 checks / 10 local-provider calls; the actual crash checkpoints passed 10 checks / six calls. This does not replace the separate pending UI acceptance.
