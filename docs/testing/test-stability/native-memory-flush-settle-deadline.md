# Native Memory flush test misses its settle deadline under full-suite load

- Bug ID: BUG-20261018-392
- Scope: `packages/apexo/test/v2/memory-lifecycle-native.test.ts`, "native flush captures a completed real turn once and reconciles concurrent exact admission"
- Observed: in one full `GITHUB_ACTIONS=false bun turbo test --concurrency=2` run the test failed with `Memory operation did not settle` after 13.5s. The settle poll allowed 10s of wall-clock time.
- Reproduction attempts: 20/20 passes running the file alone, and 10/10 passes for the single test under artificial CPU load (12 busy loops on 8 cores). The failure was **not reproduced**; root cause remains **unconfirmed**. A genuine hang in the flush worker has not been ruled out by evidence, only made unlikely.
- Hypothesis: the operation includes a provider round trip through the local test LLM server plus durable commits; under concurrent full-suite load the wall-clock settle wait can exceed 10s.
- Change: the settle wait is now 20s and this test's timeout is 60s (it waits twice). A real hang still fails at 20s with the same message.
- Verification: the file passes alone; the complete unit gate passes after the change. Keep this record open if the failure recurs with the longer deadline.

## Second occurrence (same root-cause family)

- `test/v2/memory-legacy-native.test.ts` "legacy semantic flush deduplication suppresses >0.92 matches..." failed with `Memory operation did not settle` after 12.6s in a serialized full unit run (`APEXO_TEST_SHARDS=1`, `--concurrency=1`) on the shared host. It passes 3/3 alone and the whole file passes 48/48.
- The file's `settled` helper also used a 10s wall-clock wait. It now uses 20s, and this test (four settle waits) has a 90s timeout.
