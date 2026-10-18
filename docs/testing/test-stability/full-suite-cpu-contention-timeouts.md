# Rotating wall-clock timeouts in the full unit gate on a shared 8-core host

- Bug ID: BUG-20261018-395
- Scope: `GITHUB_ACTIONS=false bun turbo test --concurrency=2` in `packages/apexo` (17 batches of about 28 files, two shards), on a shared development VM.
- Observed: each full run failed a *different* single wall-clock test, then passed when rerun:
  - run A: `native media reference-oversize admits no outbound request` (23.0s, test limit 20s) and `native S3 download-redirect fails without fabricated local or remote success` (21.0s);
  - run B: `monitor stderr events wake an idle parent while the command is still running` (22.3s, "monitor did not process the suppressed event");
  - earlier: `native flush captures a completed real turn once...` (13.5s, see BUG-20261018-392).
- Investigation:
  - `test/e2e/v2-media.e2e.test.ts` alone: 14/14 twice; each of these tests takes about 2.5–3.3s. Every server in them is a local `Bun.serve` fixture; there is no DNS lookup, external network, retry backoff or fixed sleep beyond the 20ms poll interval in `pollWithTimeout`.
  - The complete batch 16 file list run as one `bun test` process (same co-location as the full gate): 272 pass, 0 fail, slowest test 4.5s, so it is not cross-test pollution inside a batch.
  - The same tests take 7x longer only while two apexo shards, the other turbo package tasks and the many subprocess/server-spawning tests run together on a host also used by other agents.
  - GitHub Actions `test` passed on `main` at `de326fa`.
- Conclusion: CPU contention on this host, not a product defect and not a single test bug. Per-test limit bumps are not justified because the affected test rotates. No code change; rerun the gate and record recurrences. Root cause of the slowdown beyond contention is **not proven**.
- Verification: the unit gate is rerun until it passes with all changes; see the commit's recorded gate results.
