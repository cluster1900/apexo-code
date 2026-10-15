# BUG-20261014-200: Summary fixtures used incomplete typed transport values

- **Scope:** Native Goal summary tests.
- **Status:** Verified; one observed occurrence.
- **Observed:** Apexo typecheck rejected a `Reply` returned where `Item` was required,
  plain usage objects lacking the derived `Usage` fields, a step without its reason,
  and spreading a database JSON value typed as unknown.
- **Expected:** Fixtures use the actual transport constructors and decode persisted JSON.
- **Reproduction:** Run `bun typecheck` from `packages/apexo` with the initial summary fixtures.
- **Root cause:** New fixture values bypassed the existing builder and schema boundaries.
- **Fix:** Convert the reply with `.item()`, construct `Usage`, include the step reason,
  and decode the persisted record before adding its test owner PID.
- **Verification:** Apexo `bun typecheck` exited zero. The default-on lifecycle passed
  one test and 39 assertions; the initial summary state subset passed seven tests
  and 43 assertions. No product runtime failure was attributed to these type errors.
