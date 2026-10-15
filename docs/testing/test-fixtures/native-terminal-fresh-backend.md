# BUG-20261015-183: Fresh-terminal acceptance did not forward the Desktop backend choice

- **Status:** Corrected during acceptance review and verified against the rebuilt packaged backend.
- **Scope:** `packages/apexo/script/grok-native-terminal-fresh.mjs`, mixed-server acceptance. One authoring episode, discovered by source inspection before any packaged-fresh result was claimed.
- **Observed:** The caller accepted arbitrary command-line arguments but passed only `mode` and `mixed` to `startPlanUiFixture`. The helper defaults its runtime to `cli`, so adding `--desktop` could not select the packaged Electron backend.
- **Expected:** `--mixed --desktop` must run the actual packaged backend. Source-only native fixture runs must not be labeled Desktop acceptance.
- **Reproduction:** Inspect the original caller and helper's `options.runtime ?? "cli"` default; invoke the fresh-terminal script with `--mixed --desktop` and inspect the owned backend launch. No failing product execution or false historical packaged pass is claimed.
- **Root cause:** The new mixed terminal caller omitted the existing runtime selection option when composing its fixture.
- **Fix:** Forward `--desktop` to the helper and identify the effective backend in the result. Pure-native fixtures still use their separate source server; only mixed mode retains the chosen packaged backend.
- **Verification:** Formatter and `node --check` passed on the actual script. `bun script/grok-native-terminal-fresh.mjs --mixed --desktop` with and without `--fullscreen`, from `packages/apexo`, each passed two checks / two provider calls and exited zero. Both report the Desktop backend, and their owned fixture entrypoints import the built Desktop main chunks. The runs create exactly one native Session, complete the actual Question reply and reap the PTY/backend.
