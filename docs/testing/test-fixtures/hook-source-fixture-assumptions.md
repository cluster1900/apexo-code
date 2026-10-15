# BUG-20261015-350: Hook source fixture state assumptions

- **Scope:** New host Hook source discovery and Session snapshot tests.
- **Observed:** The first implementation run passed the new duplicate-precedence and import-trust checks, but two fixture expectations failed. The discovery fixture expected three diagnostics and received four; the snapshot fixture expected a saved choice object containing only `disabled`, while the real preference store also returned its concurrency `revision`.
- **Expected:** The fixture isolates the host configuration directory from the workspace's project-hook directory and checks the behavior it owns without excluding valid preference metadata.
- **Reproduction:** Run `bun test test/plugin/hook-sources.test.ts` from `packages/apexo` with the initial fixture home set to the workspace's `.grok` directory and strict equality against `{ disabled: [hookID] }` after a real `SessionHookSnapshot.preference` call.
- **Root cause:** The fixture accidentally placed one directory in both global and project source roles, producing the legitimate exact-workspace trust diagnostic. Separately, it asserted an incomplete shape for a real revisioned preference value. Neither failure showed a production source loader or preference defect. These are distinct fixture assumptions and are not counted as recurring occurrences of one cause.
- **Fix:** Place the global Hook home in a separate fixture directory. Match the disabled selection while allowing the real revision metadata; continue asserting retained choices across explicit reload.
- **Verification:** `bun test test/plugin/hook-sources.test.ts test/plugin/hook-dedup.test.ts test/plugin/host-hooks.test.ts test/plugin/hook-environment.test.ts test/plugin/hook-snapshot.test.ts test/plugin/hook-preferences.test.ts --timeout 30000` from `packages/apexo`: 29 passed, 133 assertions. Core and Apexo `bun typecheck` passed. Native CLI Hook-source acceptance passed four checks and six provider calls.

The initial broader run also could not open local HTTP test listeners under the default process sandbox. The authorized local-socket rerun passed those existing tests; no production network change was made.

Shared integration includes the later settings-file and flat Cursor grammar controls: 31 tests / 140 assertions, Core/Apexo typechecks and native CLI four checks / six provider calls pass. Rebuilt shared Desktop remains pending.
