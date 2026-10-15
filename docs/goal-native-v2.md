# Native V2 Goal execution

The native `/api/session/:sessionID/goal` surface now drives the Core V2 SessionRunner. It does not invoke the compatibility SessionPrompt loop. Existing compatibility Goal endpoints and interfaces remain separate.

The API exposes get, create, start, run, pause, resume, clear, report listing, report reading, and report cleanup. Create persists a Goal without starting a provider. Start records the selected model and agent, durably admits its original objective, and schedules explicit process-local execution. Read operations do not recover or resume abandoned work. Start, pause, resume, and clear share a control gate so a pause cannot race an incompletely admitted launch into later execution.

The process-global Session coordinator passes its own child execution and interruption capabilities into the Location runner. Planner and verifier Sessions use those same coordinator methods; their transcripts are native projected V2 messages. Children retain a durable parent and Goal-attempt marker. Live file capabilities are scoped separately. A child with only a durable marker cannot independently resume after its owner closes or a process restarts. The first verifier may reuse its own prior transcript under a fresh attempt; other reviewers receive independent Sessions.

Each worker provider turn retains one explicit `llm.stream` invocation, followed by durable tool settlement and projected-history reload. Work finishes into an independent evaluator call. A continuation decision starts a new durable worker attempt. Candidate completion enters the existing skeptical verifier panel and only its accepted result completes the Goal. Main workers can call the canonical native `update_goal` tool to report progress or request verification; the tool cannot directly complete a Goal or alter its scope.

Actual worker, planner, verifier, evaluator, and native compaction transport usage flows into the existing attempt ledger. A provider call that ends without usable usage marks the total incomplete. Budget stops prevent another Goal provider turn. Initial objective admission is promoted before planning; ordinary queued inputs wait until the Goal would otherwise leave the Session idle. New steer batches retain the existing provider-turn allowance semantics.

Planner and verifier output is accepted from assigned private report files, not their terminal prose. The native registry supplies permitted workspace read/search/check tools plus a scoped report writer. Role model/agent overrides and fallback records use the shared Goal configuration. Parent permissions are inherited; role configuration may narrow them. Goal changes are captured once per verification round and filtered for the parent and each role. Native assistant snapshot metadata is excluded from automatic transcript evidence, because it is host-generated rather than permission-filtered review material.

The existing durable report reservation, hash verification, terminal cleanup manifest, live-process teardown barrier, optional retention policy, and report-download contracts are reused. Native cleanup releases its barrier after the parent scope and its owned review children finish closing. A real process death leaves the Goal attempt durably active until explicit resume recovers it. Reading state after restart does not retry provider work.

## Verification

Run with Bun 1.3.14 from `packages/apexo`:

- `bun test test/e2e/v2-goal.e2e.test.ts test/e2e/v2-session.e2e.test.ts`
- `bun script/grok-goal-v2.mjs cli`
- `bun script/grok-goal-v2.mjs desktop` after the shared production Desktop build.
- `bun script/grok-goal-official.mjs --execute --workspace` for the installed official planner/verifier artifact comparison.

The latest combined native Session, Goal, Workflow, compaction, coordinator and deletion gate passed 16 tests and 159 assertions. It verifies independent child execution, usage, reports, queued delivery after completion, exact budget stop, and visible parent/child ownership followed by cancellation of both. A forced manual summary at the final worker boundary charges seven tokens to the live Goal attempt before evaluation. A separate eight-token budget scenario stops at 13 actual tokens after planner, worker and summary receipts, without starting the evaluator. Workflow automatic summaries also reach their owner receipt ledger. Managed child manual compaction returns an explicit failure and preserves the final result for its owner. The CLI production fixture passed five scenarios and 37 actual provider calls, including independent continuation, pause/resume, terminal scratch cleanup, and SIGKILL recovery without an automatic retry. The production Desktop fixture also passed five scenarios and 37 actual provider calls.

With both HOME and GROK_HOME isolated, installed Grok 1.0.52 passed three independent planner/verifier workspace-artifact checks with 22 provider requests. This compares lifecycle behavior and artifact use; Grok does not expose Apexo's native V2 API or event projection model. The pinned source baseline remains `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`.

Native Goal execution does not close the remaining native tool-registry parity gaps, compatibility strategy execution, proprietary harness styles, progress-summary policy, clustered execution, or Windows/Linux acceptance. Native compaction has dedicated accounting, failure and cancellation integration coverage. Its real CLI and freshly built packaged Desktop backend acceptance each passed five scenarios with four provider calls. See [native compaction](native-session-compaction.md) for its contract and isolated installed-runtime comparison. Native Goal UI routing now has focused browser coverage; the earlier five-scenario Desktop backend acceptance does not establish acceptance of the freshly routed UI, which awaits the shared production build.

Related records: [launch boundary](testing/runtime/goal-v2-launch-boundary.md), [initial runtime binding failure](testing/runtime/profile-cli-session-execution-layer.md), and [snapshot evidence isolation](testing/permissions/goal-v2-snapshot-evidence.md).

Native stall-triggered strategy advice is implemented with durable cadence,
owned child Sessions, immutable plan inputs and complete usage accounting. See
[the strategy contract](native-goal-strategy.md) for CLI, freshly packaged Desktop and installed-reference evidence.

## Optional closing summary

Verified native Goals now grant one terminal-owned, tool-free child turn for an optional closing summary. Completion is durable before the child runs; summary failure, cancellation, budget overshoot and crash recovery cannot reopen it. The dedicated CLI acceptance passed ten scenarios with 80 provider requests. The freshly built production Desktop backend passed the same ten scenarios and 80 requests. See [the closing-summary contract](native-goal-summary.md) for once-only ownership, receipts, restart policy and installed-runtime comparison.
