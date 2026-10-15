# BUG-20261014-255: Compatibility Goal updates omitted the permission request

- **Scope:** Compatibility `update_goal` in `packages/apexo/src/tool/grok-build.ts`.
- **Status:** Fixed; focused compatibility regression and native CLI acceptance passed.
- **Observed:** Source review found that the compatibility tool checked the active
  attempt and called `SessionGoal.update` without asking the permission service.
  The native tool already asserted `update_goal`. This is a static finding, not a
  claim of multiple observed unauthorized updates.
- **Expected:** Both tool surfaces request the canonical `update_goal` permission
  before mutating Goal progress, while retaining active main-worker ownership.
- **Reproduction:** Inspect the compatibility tool's execution path or invoke the
  actual registered profile extension with an active worker and a denied permission
  context. A denied context must leave the persisted Goal unchanged.
- **Root cause:** The compatibility profile extension omitted `ctx.ask`, unlike
  other mutating compatibility tools and the native Goal tool.
- **Fix:** Ask for `update_goal` against the owning Goal ID before the shared
  transactional mutation. Do not loosen native assertions or child ownership.
- **Verification:** The actual compatibility profile tool with real Goal storage
  now checks the requested permission, persists valid progress, and rejects denied
  and foreign-child contexts without changing the Goal. The six-file regression
  passed 180 tests, one existing skip and 1,104 assertions. Native CLI acceptance
  passed valid, invalid and permission-denied scenarios with 11 requests and 1,320
  tokens each. Full package and Desktop verification are tracked in the feature doc.
