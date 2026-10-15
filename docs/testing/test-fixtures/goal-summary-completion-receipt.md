# BUG-20261014-201: Summary integration read completion before its optional receipt

- **Scope:** Default-on native Goal lifecycle integration.
- **Status:** Verified; one observed occurrence.
- **Observed:** The fixture expected 23 tokens but read 21 immediately after verification
  committed complete, before the separate two-token summary settled.
- **Expected:** Completion may be visible before the optional summary; assertions about
  summary usage must wait for its terminal receipt.
- **Reproduction:** Run `bun test test/e2e/v2-goal.e2e.test.ts` from `packages/apexo` with
  a poll that treats an absent summary field as settled.
- **Root cause:** The poll confused verified completion with completion of optional work.
- **Fix:** Require completed summary state in the successful default-on scenario. The
  dedicated CLI scenario separately holds the child and proves completion is visible first.
- **Verification:** The native lifecycle passed one test and 39 assertions. The CLI
  summary acceptance passed ten scenarios and 80 provider requests, including the held child.
