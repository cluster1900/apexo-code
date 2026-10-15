# BUG-20261015-159: Copied Plan fixture expected Monitor fields at the wrong level

- Status: fixed and verified privately and in the shared 141-test / 803-assertion Monitor/Memory/terminal gate.
- Scope: new real HTTP Plan/Monitor integration test. One occurrence; not a product defect.
- Observed: pending Plan approval was reached correctly, but an assertion expected top-level `persistent: true`. The actual domain response correctly contained `background: true`, `kind: "monitor"`, and `monitor.persistent: true`.
- Cause: a blanket substitution adapting the Shell fixture changed both the Monitor tool argument and an unrelated summary expectation.
- Fix: assert the actual additive summary projection explicitly; preserve the independent background execution flag.
- Verification: `bun test test/e2e/v2-plan-monitor.e2e.test.ts` from `packages/apexo` passed one test and 20 assertions. The actual Monitor event remained pending while the Plan question was open, produced no provider call before approval, then delivered through the ordinary runner; terminal completion followed without a fabricated durable user prompt. The composed seven-file gate also passed 28 tests and 332 assertions.
