# BUG-20261015-052: Hook preference fixture expected null for an omitted optional field

- **Scope:** New native CLI Hook preference acceptance script.
- **Observed:** After successful saved-choice persistence, held-dispatch, restart and corrupt-store checks, the fixture failed its final recovery assertion: actual `preferenceFailure` was `undefined`, expected `null`.
- **Expected:** Absence of an error follows the canonical optional schema helper and omits the property on the JSON wire.
- **Root cause:** The script assumed nullable optional output instead of the public schema's omitted-key representation. This is a fixture assertion error, distinct from implementation codec normalization.
- **Fix:** Expect `undefined` after repair; keep the corrupt-store rejection, exact saved bytes and retained effective choice assertions unchanged.
- **Reproduction:** From `packages/apexo`, run `bun script/grok-hook-preferences-native.mjs cli` with the original null assertion.
- **Verification:** Corrected isolated CLI acceptance passed six checks with ten provider requests. Management requests caused no model work. Product source was unchanged for the rerun.
- **Occurrences:** One fixture-authoring failure; no recurrence promotion.
