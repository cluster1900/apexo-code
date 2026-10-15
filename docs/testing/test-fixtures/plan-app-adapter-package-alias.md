# BUG-20261015-116: Plan acceptance imported App aliases into the Apexo TypeScript project

- **Status:** Corrected in the isolated Plan acceptance script; Apexo typechecking passed.
- **Scope:** CLI/Desktop acceptance fixture package boundary, not product API or compiler configuration.
- **Observed:** Apexo typechecking reported three unresolved App `@/context/server` and `@/utils/base64` imports after the fixture statically imported the real App server adapter. The adapter's earlier socket run had passed, but that did not verify this package boundary.
- **Expected:** The actual App adapter runs in acceptance while each package retains its own TypeScript alias authority.
- **Cause:** A static cross-package TypeScript import made Apexo's compiler resolve App aliases using Apexo's `@/*` configuration.
- **Fix:** Resolve the actual App module URLs at runtime in the acceptance script. Do not duplicate the adapter, cast its API, edit vendored SDK code, or relax either package's compiler configuration. App remains independently typechecked; the acceptance script still executes the actual adapter against the native server.
- **Reproduction:** Run `bun typecheck` in `packages/apexo` with the original static imports in `script/grok-plan-native.mjs`.
- **Verification:** Apexo package typechecking passed after the import-boundary repair. The updated recovery socket run passed 13 checks / 10 provider calls using the real App adapter. Independent App typechecking remains a separate pending UI gate.

Shared integration verification: the combined native Plan and background Task approval suite passed 14 tests / 153 assertions; all 21 repository typecheck tasks passed. CLI and rebuilt Desktop recovery each passed 13 checks / 10 local-provider calls; the actual crash checkpoints passed 10 checks / six calls. This does not replace the separate pending UI acceptance.
