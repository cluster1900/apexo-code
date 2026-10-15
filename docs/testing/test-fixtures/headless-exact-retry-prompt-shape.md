# BUG-20261015-218: Historical retry fixture changed optional prompt fields

- **Scope:** Private headless input replay fixture.
- **Observed:** The expanded historical replay test failed with `Session.PromptConflictError` after 21 assertions.
- **Expected:** An exact retry must preserve the original canonical prompt, including optional fields.
- **Root cause:** The fixture published a historical prompt containing explicit empty `files` and `agents` arrays, then retried with both fields omitted. Those are different stored prompts under the existing exact-identity contract.
- **Correction:** Construct the original historical event and its retries with the same omitted-field shape. Production equality remains unchanged.
- **Verification:** `bun test test/v2/input-execution.test.ts` passed one test / 37 assertions in the private implementation, including historical ordinary defaults, headless replay, policy conflicts and passive outcomes. No product fix or recurring occurrence is claimed.
