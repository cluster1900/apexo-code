# BUG-20261014-257: Compatibility progress fixture did not enable profile extensions

- **Scope:** New compatibility `update_goal` regression in `test/session/goal.test.ts`.
- **Status:** Verified fixed.
- **Observed:** The first focused run passed 78 tests and failed one because
  `adaptTools([], { goals })` returned no `update_goal`; accessing its execute
  method failed before the permission/state assertions ran.
- **Expected:** The fixture exercises the actual registered compatibility profile
  extension under its normal prerequisites.
- **Reproduction:** Adapt an empty tool list with only `goals`, then search for
  `update_goal`. Profile extensions are intentionally absent in that configuration.
- **Root cause:** The fixture omitted both `profileExtensions: true` and the real
  BackgroundJob service required by extension assembly.
- **Fix:** Construct `BackgroundJob.make` in the scoped real fixture and explicitly
  enable profile extensions. Do not relax production adapter conditions or insert
  a fabricated Goal tool.
- **Verification:** The corrected six-file regression passed 180 tests, one
  existing skip and 1,104 assertions, including valid progress, canonical permission
  requests, denied writes and foreign-child ownership rejection. This record covers
  one observed fixture failure; no recurring constraint is promoted.
