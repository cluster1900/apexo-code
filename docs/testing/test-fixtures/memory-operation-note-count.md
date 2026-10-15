# BUG-20261015-233: Capture fixture counted the generated index as an observation

- **Scope:** Native Memory lifecycle acceptance catalog assertions; no product defect.
- **Observed:** After fixing actual observation publication, the new script expected one catalog entry and received two.
- **Cause:** The canonical V2 catalog correctly exposes both generated `MEMORY.md` and the committed observation. Catalog entry count is not observation count.
- **Fix:** Assert exactly one observation under the canonical inbox path, assert the generated index separately, preview the exact observation content, and compare that observation's identity after restart. No catalog behavior or success criteria were relaxed.
- **Verification:** `bun script/grok-memory-native-lifecycle.mjs cli` from `packages/apexo` passed five checks, including publication and preservation across crash/retry, with two ordinary and three extraction requests.
