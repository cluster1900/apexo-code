# Native Plan mode

Apexo owns Plan entry, approval, persistence and continuation through its native Session runner. The installed Grok1.0.52 and pinned source are comparison evidence only; product execution never calls the reference executable or embeds its orchestration.

Ordinary root Sessions using the build/plan primary agents can enter Plan mode. A mode transition waits until the provider response and ordinary sibling tools settle. The selected agent is durably changed through AgentSwitched; no synthetic user message is inserted. The existing provider-turn and prompt-inbox rules remain authoritative. Managed children, child Sessions and active Goal work are refused before the transition rather than bypassing pinned role or usage ownership.

Plan mode permits edits only to its incarnation-bound workspace plan artifact. It retains supported inspection tools and Bash. Bash uses existing native permission, AppProcess and selected command-sandbox policy; Plan introduces an actual ask boundary, and configured hard denial wins. This is not a shell classifier, read-only execution guarantee or whole-agent sandbox. Task, Workflow and dynamic tools are withheld in this initial mode policy.

Exit captures the exact plan content, canonical path, hash, original assistant/tool identity, Session Created proof and selected-agent revision. A durable pending Question presents that review. Only the canonical explicit Approve answer can switch back to build; Keep planning remains in Plan. Changes to the artifact, selected authority or current hard permissions prevent stale approval. The presentation-only purpose marker is not accepted from model Question prompts and grants no authority.

Crash recovery lists the exact original pending review without provider work. Idle Stop remains a no-op; explicit Question dismissal cancels a restored pending review. An accepted active Stop cancels its wait and fences its process-local continuation token. A genuinely new recovered decision can authorize one advisory wake under the original lifecycle claim. Exact answer retry is acknowledged without scheduling; conflicting retry returns409, current denial403, unavailable receipt storage503, and genuinely absent owned questions404.

QuestionV2.reply returns an internal original-incarnation claim only when a new recovered decision requires scheduling. The native HTTP handler schedules global SessionExecution.wake under that claim. In-process callers have the same explicitly documented responsibility; the Location graph does not own or bind global execution. No startup, load or list operation starts model work.

Pending Plan review blocks ordinary wake/continuation selection before Task completion is consumed or another provider turn starts. Receipt reconciliation handles only the original Plan tool. After a crash following durable approval or original tool success, exact answer retry remains passive; an explicit resume or genuine new input can reconcile the exact tool and Step.Ended once. This does not implement generic interrupted-tool replay. The stored decision cannot override a newly configured hard deny. Manual compaction is refused while review is pending.

## Verification before shared integration

- Native actual-runtime suite:13 tests,133 assertions, including same-batch exit-before-write, explicit approval/rejection, cancellation, deletion, changed content/agent, failed provider batch, real permission ask, Bash allow-once and hard deny.
- CLI recovery and actual App API adapter:13 checks,10 local-provider calls. Includes crash re-presentation, passive reads/idle Stop, exact retry/conflict, current hard denial after restart, blocked prompt wake and explicit dismissal.
- Real crash checkpoints:10 checks,6 calls. Fixture-only preload observes the actual postcommit notification bus and parks the owned process; the parent kills/reaps it. SQLite proves one original tool success and one Step.Ended after recovery. No fabricated receipt or production failpoint.
- Core and Apexo package typechecks passed before UI work. Current public changes require root-owned Client/legacy SDK generation at integration; private DB aggregates are excluded from the handoff.
- Installed comparison: default/ask/deny5/4/1 checks; parked approval4 checks/3 calls; real Plan shell ask/write4 calls. Initial fixture assumptions and corrections remain in BUG096.

These were pre-integration results; the shared checkpoint below supersedes their pending integration gates. The separate UI slice localizes review controls in en/zh/zht while retaining exact artifact data and canonical submitted answers. Other locales use existing English fallback. This document does not claim completed whole G07 parity or all custom-agent Plan support.

## Shared integration checkpoint

The backend and active-Stop event repair are now integrated. The shared suite
`bun test test/e2e/v2-plan.e2e.test.ts test/e2e/v2-plan-task-completion.e2e.test.ts`
passed 14 tests / 153 assertions. The added real HTTP integration verifies that
an independently finishing background Task remains blocked by pending Plan
approval, then delivers its completion exactly once after approval without
inventing a user input. All 21 repository typecheck tasks passed.

Root-owned Core migration generation produced the same table/index DDL as the
reviewed proposal under a fresh migration ID; `bun run migration --check` passed.
Client and legacy SDK generation completed, and `bun run check:generated`
passed against an isolated candidate Git index. The real working index was not
modified. Shared CLI and rebuilt Desktop recovery each passed 13 checks / 10 local-provider
calls. The shared actual crash checkpoints passed 10 checks / six calls across
durable decision and original tool success. The later shared Plan/media UI aggregate passed all six Turbo tasks, including 4,155 Apexo test passes with zero failures; it excludes the subsequent Shell/media-options integration.

The integrated localized presentation now passes six checks / six calls in both production browser and actual rebuilt Desktop. All 21 shared types remain green after composing the media UI. The compatibility HttpApi gate separately passed 299 scenarios in each of its three modes; this inventory is not substituted for native Plan tests. The fixed-backend Plan-only composer measurement is complete: 114.5 ms median / 118 ms p95 versus the preserved baseline’s 113.5 / 130 ms, with no Long Task entries. These small samples do not establish a causal timing difference; see the [measurement record](testing/performance/native-media-plan-composer.md). Native-only terminal bootstrap remains open.
