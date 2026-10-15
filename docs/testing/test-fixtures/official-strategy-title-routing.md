# Official strategy fixture classified a title request as planning

- **Bug ID:** BUG-20261014-166
- **Type:** Test fixture request classification
- **Scope:** Installed Goal strategy, Workflow schema and headless comparisons
- **Status:** Verified
- **Independent occurrences:** 4

The first comparison produced `infra_paused` with no plan. Request evidence showed
that a title request included the planner prompt but exposed only `session_title`.
The fixture matched the embedded planner text first, advanced its file-write
counter, and sent a plan write through the title response. The subsequent real
planner received Done without its required file.

The fixture now recognizes the title tool before matching role prompts and sends
a proper session-title function call. Only actual role requests advance report
steps. This is an isolated reference-fixture error, not an Apexo runtime defect.

Verification uses `bun run script/grok-goal-strategy-official.mjs` from
`packages/apexo`, against the isolated installed runtime and a local provider.

Final verification: `bun run script/grok-goal-strategy-official.mjs` from
`packages/apexo` passed two checks with 37 local requests on installed Grok
1.0.52. The isolated child exited and final stderr was empty.

## Workflow schema comparison occurrence (2026-10-15)

A separate schema-correction fixture initially counted four child requests when
only two were actual child requests. Its text search also matched the quoted
child prompt inside ancillary `<user_query>` requests. This is the same request
classification mistake as the strategy occurrence, not a product retry defect.

The schema fixture identifies the raw last user prompt or correction prefix
instead of matching embedded role text anywhere in a request. Installed Grok
1.0.52 then passed both invalid-then-valid and invalid-twice comparisons: each
had two actual child requests, four total requests, one logical agent, and ten
child tokens. Commands from `packages/apexo` are
`bun script/grok-workflow-schema-official.mjs` and the same command with
`--always-invalid`. The original failed count remains distinct evidence; only
the corrected classifier produced these verified counts. The new fixture is
currently an off-tree draft pending integration.

## Headless comparison occurrence (2026-10-15)

A separate installed headless fixture selected any request with nonempty tools as a conversation. The title request used the Responses `input` representation and advertised `session_title`; the prompt-file assertion therefore selected it before the real Chat Completions user message and failed on an absent `messages` field. Five output-format checks had passed, but their initial conversation/auxiliary counts were invalid. This is a third independent title-classification authoring episode, not another failure of the earlier fixtures.

The corrected fixture classifies the title tool and wire protocol first, serves valid Responses title events, then selects the actual conversation's current user message. Its next run passed seven scenarios before an independently invalid PNG fixture failed; the final corrected `bun script/grok-native-headless-official.mjs` run passed sixteen scenarios with 19 conversation and 60 auxiliary requests, including one isolation-preflight request. All owned processes/listeners were reaped. No Apexo product behavior changed.

Recurring constraint: [RULE-20261015-016](../../rules/fixture-evidence-projection.md) now explicitly requires ancillary protocol/tool classification before role request counts or current-input assertions.

## Nested Task reference audit (2026-10-15)

During shared integration, source review found that the new nested Task comparison excluded title requests but still treated any other nonempty tool catalog as a conversation. This is preventive hardening of the same classification boundary; no actual dashboard misclassification was observed in its retained run, so the independent occurrence count stays at three.

The shared fixture now explicitly detects dashboard system instructions, requires the actual Chat Completions route and expected read-file catalog for conversations, and rejects an unknown provider POST. Provider callback failures are captured in per-case evidence and fail acceptance instead of escaping the HTTP listener. `node --check packages/apexo/script/grok-native-task-advanced-official.mjs` passes from the repository root. From `packages/apexo`, `bun script/grok-native-task-advanced-official.mjs` passes all three cases with eleven conversation and seventeen auxiliary requests, no captured callback failures and clean case exits. The hardened run reproduces the earlier counts; it does not retroactively establish any untested delivery behavior.

## Operator Task comparison occurrence (2026-10-15)

A separate operator wake fixture counted two initial child requests instead of one because the child title request carried the same user text. The corrected count excludes the advertised `session_title` tool before selecting child conversation messages. The isolated installed comparison then passed three checks with two actual child provider turns and seven total requests. It proves a human-address message resumes the completed child with its prior assistant result. Command: `bun script/grok-task-operator-wake-official.mjs` from `packages/apexo`.

Earlier setup attempts cancelled the spawn permission and selected the nonexistent snake-case `agent_address` field. The fixture now explicitly selects allow-once and reads the observed `agentAddress` notification field. These setup mistakes are not additional title-classification occurrences or Apexo runtime failures.
