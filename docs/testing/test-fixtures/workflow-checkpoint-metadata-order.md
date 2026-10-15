# BUG-20261014-130: Installed reference checkpoint fixture construction error

- Scope: Installed reference checkpoint fixture.
- Observed: The comparison timed out before reaching paused; ACP reported invalid script metadata ordering.
- Expected: The fixture reaches the intended lifecycle check.
- Root cause: The fixture prepended await_user before the required initial let meta declaration.
- Fix: Keep metadata first and insert the checkpoint after it.
- Reproduction: Run `bun script/grok-workflow-official.mjs --checkpoint` from packages/apexo with the earlier fixture.
- Verification: Corrected installed-runtime comparison passed three checks, with two provider calls and exactly one workflow child. No product failure is inferred.
- Occurrences: One observed fixture failure.
