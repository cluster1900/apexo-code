# Native Goal strategy adviser

The native Goal runner can request a strategy recommendation after repeated
unsuccessful independent verification. Apexo owns the child Session, its tools,
permissions, report files, usage ledger and cancellation. No product path invokes
the Grok executable.

`goal.strategist_every` defaults to five unsuccessful verification rounds and is
floored at one. A valid unsigned `GROK_GOAL_STRATEGIST_EVERY` overrides it.
`goal.strategist_model` uses the existing `{model, agent_type}` pair, where the
agent is a configured Apexo agent. The shared current-model-only parser preserves explicit false overrides, accepts
trimmed case-insensitive true/false spellings and falls back to configuration for
invalid values.
Unavailable selections fall back through native model/agent resolution and record
the actual execution in the strategy result. This does not implement proprietary
Grok harness styles.

The adviser runs at the beginning of the next native worker attempt. Before
starting its child, Core atomically claims the current verification-round count.
The next claim requires at least another configured interval; pausing, reloading
or explicitly resuming cannot repeat the already claimed interval. Existing
identical-gap and verification-cap stops take precedence: strategy advice cannot
bypass a no-progress pause.

The child receives the original objective, unchanged plan, unmet requirements and
bounded projected evidence. It inherits parent permissions and may narrow them
through its selected agent. Its tool inventory excludes shell execution and
workspace writes. The scoped report writer permits only its assigned
`strategy.md`. Objective, evidence and copied plan inputs are immutable and
hash-checked when the child closes. The latest strategy report uses the existing
report catalog, integrity-checked download and retention protection.

A successful recommendation is persisted with its child Session, actual
model/agent and report references. At most 4096 Unicode characters are included
in the associated worker round's system context, with a pointer to the full
report. It does not replace the plan or alter any acceptance criteria, and it is
not repeatedly injected into later worker rounds.

Ordinary missing or invalid advice with complete transport usage records a failed
advisory and continues work from the unchanged plan. Missing transport usage
preserves `usageIncomplete` and pauses as infrastructure failure. Budget,
cancellation, stale-owner and storage failures cannot be treated as successful
advice. Every adviser request, including compaction and retries in its native
child, charges the current Goal attempt through the existing receipt ledger.

For example, with a 1000-token budget, a fixture used 840 tokens before the
adviser and 240 tokens in its two requests. The Goal stopped at 1080 actual tokens
before the next worker request. A different fixture returned complete usage but
omitted `strategy.md`; the advisory failed and independent work continued. A
transport error without usage instead paused the Goal.

## Verification

From `packages/apexo` using pinned Bun 1.3.14:

- `bun test test/session/goal.test.ts test/session/goal-files.test.ts`: 68 tests,
  455 assertions passed, including durable cadence, late results, budget and
  missing-usage handling, and immutable report capabilities.
- `bun test test/e2e/v2-goal.e2e.test.ts test/e2e/v2-compaction.e2e.test.ts test/session/goal-reports.test.ts`:
  seven tests and 99 assertions passed.
- `bun run script/grok-goal-strategy.mjs cli`: six scenarios and 71 actual
  provider requests passed. These cover advice, unavailable output, budget,
  unchanged no-progress safety, missing usage, and cancel/resume ownership.
- `bun run script/grok-goal-strategy-official.mjs`: two installed-reference checks
  passed with 37 local provider requests.
- `bun run script/grok-goal-strategy.mjs desktop`: the freshly built packaged
  backend passed the same six scenarios with 71 actual provider requests.
  The fixture-owned backend and provider were closed after completion.
- Runtime flag tests passed 42 tests and 172 assertions, including native role
  selection precedence. Core and Apexo package typechecks passed.

The initial optional-result validation defect is recorded in
[BUG-20261014-165](testing/runtime/goal-strategy-optional-results.md).
This slice applies to native Goal execution. Compatibility strategy execution,
progress-summary policy, proprietary harness styles and cross-platform
acceptance remain separate work.

## Installed comparison

The isolated installed Grok 1.0.52 runtime fired its strategist after one failed
verification when configured with cadence one. It delivered the recommendation
to the next worker while preserving the canonical plan, and a missing strategy
file failed open before the next worker completed the Goal. The 37 requests
include ancillary title generation; they are not all worker or adviser calls.
The source baseline is `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.

Apexo uses scoped report capabilities and excludes shell execution from this
advisory role. It keeps its existing missing-usage infrastructure pause policy
rather than treating unknown billing as an ordinary advisory failure. These are
explicit native policy choices; the comparison does not imply identical
proprietary harnesses or identical failure handling in every case.

Reference fixture corrections are recorded separately as
[title routing](testing/test-fixtures/official-strategy-title-routing.md),
[terminal observation](testing/test-fixtures/official-goal-terminal-observation.md)
and [plan promotion](testing/test-fixtures/official-strategy-plan-promotion.md).
