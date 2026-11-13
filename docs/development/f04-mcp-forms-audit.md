# F04 branch audit: `mcp-forms`

- **Branch:** `mcp-forms`
- **Reviewed commit:** `f26259af48bd4a67764db8dd63f7296faec711f6` (`fix(mcp): complete form hydration across clients`)
- **F04 feature commit:** `9add09e1921728afb2c49de6ebbfc53935ebb65d` (`feat(mcp): add typed form elicitation`)
- **Branch base before F04:** `ea2b052e59189566293075963b9d8d45073e9449` (`feat(review): implement structured code review (#206)`)
- **`main` at audit time:** `e4885b0378a0cd88b703133f435fd47383cff64a`
- **PR:** #207, open draft; not merged during this audit
- **Date:** 2026-11-13
- **Working tree:** clean before the audit. The audit added this document and one link from [f04-audit.md](f04-audit.md); no production code was changed.
- **Purpose:** re-audit the repaired F04 branch against section 5 and E01–E09 of [the approved plan](codex-first-batch-plan.md), including real mini/fullscreen PTY, browser App and rebuilt Desktop acceptance. The pre-repair findings and their remediation remain in [f04-audit.md](f04-audit.md) and [f04-implementation.md](f04-implementation.md).

## Verdict

**F04 is functionally complete against the documented scope on `mcp-forms`. No blocking or reproduced functional defect was found.** All four UI surfaces passed real acceptance, the focused and end-to-end F04 suites passed, the repository gates passed, and the HTTP exerciser passed every scenario. Two low-priority App/Desktop interaction observations and one dead export remain; none changes the acceptance result, and none justifies new architecture.

The branch should stay in human review as draft PR #207. Merge remains gated on the required GitHub checks and human authorization.

## Verification performed

All fixture processes in these runs were owned by their acceptance scripts.

| Check | Result |
| --- | --- |
| Focused F04 suites: form, core, runner, client, event manifest | 31 passed, 0 failed, 217 assertions across 5 files |
| `test/e2e/v2-mcp-elicitation.e2e.test.ts` | 2 passed, 0 failed, 20 assertions (33 tests / 237 assertions total, matching the checkpoint) |
| `bun script/mcp-forms-api.mjs` | 6 checks passed: cross-session rejection and pending preservation, strict payloads, duplicate idempotency and action conflict, owner deletion, nested/worktree discovery through Promise and Effect clients, backend restart with stale reply 404 and no provider replay |
| `bun script/mcp-forms-tui.mjs` | Mini PTY: 10 checks passed, including defaults not auto-submitting, inline validation, explicit accept, Decline, Escape cancel, direct and nested Task forms, optional prototype-named fields |
| `bun script/mcp-forms-tui.mjs --fullscreen` | Fullscreen PTY: the same 10 checks passed |
| `bun script/mcp-forms-ui.mjs browser` | Real Chrome: 14 checks passed, including prefill, inline validation keeping the form pending, reload hydration, accept/decline/Escape cancel, Session interrupt, descendant and special-name forms |
| `bun script/mcp-forms-ui.mjs builtin` | Rebuilt Desktop with its own authenticated sidecar: 15 checks passed, including the owned backend check |
| `bun turbo typecheck --concurrency=2` | 21/21 tasks successful; Turbo reported all tasks cached |
| `GITHUB_ACTIONS=false bun turbo test --concurrency=2` | 6/6 tasks successful; 4 cached, 2 fresh |
| Client `bun run check:generated` | Passed; no generated diff |
| SDK `bun run check:generated` | Passed; no generated diff |
| `bun run test:httpapi` in `packages/apexo` | Coverage, auth and Effect modes each passed 358 scenarios: 0 failed, 0 skipped, 0 missing, 0 extra |
| Manual browser probes | See "Non-blocking observations" and "Checked and not reproduced" |

No page hang, white screen, unhandled rejection or console error was observed in the browser or Desktop runs. The only backend warning during acceptance was the intentional `unexpected: true` strict-payload rejection produced by the API script.

## Requirement conformance

| Plan item | Implementation | Assessment |
| --- | --- | --- |
| 5.1 flat field subset and visual defaults | [`mcp-elicitation-form.ts`](../../packages/core/src/mcp-elicitation-form.ts#L19), validation at [line 110](../../packages/core/src/mcp-elicitation-form.ts#L110) | Present. Types, formats, bounds, required/defaults, unknown keys, 32 fields, 100 choices and 64 KiB limits are covered by focused tests. Defaults prefill only. |
| 5.1 one active form per tool call | [`mcp-call.ts`](../../packages/core/src/mcp-call.ts#L136) plus the Core pending check | Present. A concurrent second form is rejected immediately; sequential forms remain possible. |
| 5.2 shared connection, call gate, connection generation | [`mcp-call.ts:23`](../../packages/core/src/mcp-call.ts#L23), capability at [`mcp.ts:325`](../../packages/core/src/mcp.ts#L325) | Present. Tools, resources and catalog requests share one permit; non-tool work never owns a form. |
| 5.2 form-only capability and no URL mode | [`mcp.ts:350`](../../packages/core/src/mcp.ts#L350) | Present. The handler advertises form mode and rejects URL mode. |
| 5.2 cancellation retires the generation and never replays | [`mcp-call.ts:75`](../../packages/core/src/mcp-call.ts#L75), [`mcp.ts:442`](../../packages/core/src/mcp.ts#L442) | Present. Queued work through a retired client is rejected; reconnect starts fresh server work. |
| 5.3 in-memory Location-scoped pending state, no table, no startup sweep | [`mcp-elicitation.ts:69`](../../packages/core/src/mcp-elicitation.ts#L69), list/reply at [lines 157 and 163](../../packages/core/src/mcp-elicitation.ts#L157) | Present. No elicitation SQL table or migration was added. |
| 5.3 events without answer content | Schema event definitions and event-manifest test | Present. Requested carries IDs, attribution, message and schema; settled carries action/reason; neither carries submitted answers. |
| 5.3 human wait and hard cap with paused active budget | [`mcp-call.ts:53`](../../packages/core/src/mcp-call.ts#L53) and SDK timeout wiring at [line 87](../../packages/core/src/mcp-call.ts#L87) | Present. Five-minute human wait, fifteen-minute hard cap, paused active budget and combined cancellation signal are covered by real SDK timeout tests. |
| 5.3 timers and listeners cleared on terminal paths | Core form finalizers and call exit | Present. No leaked-timer regression was observed. |
| 5.4 list/reply API, exact-session default and descendant discovery | [`protocol group`](../../packages/protocol/src/groups/mcp-elicitation.ts#L21), [`server handler:23`](../../packages/server/src/handlers/mcp-elicitation.ts#L23) | Present. Default listing stays Session-local; `includeDescendants=true` enables the fixed subtree hydration; replies remain owner-only. |
| 5.4 shared typed docks in TUI and App/Desktop | TUI [`index.tsx:1428`](../../packages/tui/src/routes/session/index.tsx#L1428), mini [`footer.view.tsx:1054`](../../packages/apexo/src/cli/cmd/run/footer.view.tsx#L1054), App [`dock`](../../packages/app/src/pages/session/composer/session-mcp-elicitation-dock.tsx#L69) | Present. Server attribution, deadline, editable defaults, constraints, validation, Submit/Decline/Cancel and Escape cancel are exercised on all four surfaces. |
| 5.4 captured interaction eligibility | [`llm.ts:770`](../../packages/core/src/session/runner/llm.ts#L770), Task inheritance at [`task.ts:137`](../../packages/core/src/session/task.ts#L137) | Present. Native runner tests cover manual/auto-accepted permissions, both headless policies, inherited headless children, scheduled launches/descendants and ordinary interactive children. |
| E01 exact typed values and defaults | Real stdio, stateful HTTP, sessionless HTTP and stateless stdio suites | Passed. |
| E02 invalid schema/reply rejection before forwarding | Focused form tests and real API/UI probes | Passed. Strict excess properties return 400 while the form stays pending. |
| E03 shared state, two Sessions, resource isolation | Integration suite | Passed. Resource reads cannot steal an armed tool's form. |
| E04 decline, cancel, server cancel, interrupt, late form | Integration suite and four-surface interrupt checks | Passed. |
| E05 active/human/hard budgets, repeated forms, no leaks | Real SDK timeout suite | Passed. |
| E06 reload, restart, reconnect, queued callers | Browser reload, API restart and reconnect checks | Passed. |
| E07 idle/init rejection, concurrent second form, duplicate click | Integration suite | Passed. |
| E08 headless/scheduled/unattended vs interactive | Native runner suite | Passed. |
| E09 mini/fullscreen/App/Desktop | Real PTYs, Chrome and rebuilt Electron | Passed. |

Architecture scope also matches the plan: no elicitation table, no per-call MCP process, no replacement orchestration runtime, no URL mode, no dependency upgrade. The two `package.json` changes in the feature commit only add export-map entries.

## Main implementation points reviewed

| Area | Files |
| --- | --- |
| Form schema/reply validation and limits | [`packages/core/src/mcp-elicitation-form.ts`](../../packages/core/src/mcp-elicitation-form.ts) |
| In-memory pending/settled state, lifecycle registration, events | [`packages/core/src/mcp-elicitation.ts`](../../packages/core/src/mcp-elicitation.ts) |
| Per-connection gate, captured eligibility, budgets and hard cap | [`packages/core/src/mcp-call.ts`](../../packages/core/src/mcp-call.ts) |
| Capability advertisement and SDK handler registration | [`packages/core/src/mcp.ts`](../../packages/core/src/mcp.ts) |
| SDK drafts/content helpers and shared live watcher | [`packages/sdk/js/src/v2/mcp-elicitation.ts`](../../packages/sdk/js/src/v2/mcp-elicitation.ts) |
| Exact-session and descendant listing | [`packages/server/src/handlers/mcp-elicitation.ts`](../../packages/server/src/handlers/mcp-elicitation.ts) |
| TUI dock and mini/fullscreen hydration | [`packages/tui/src/component/mcp-elicitation-prompt.tsx`](../../packages/tui/src/component/mcp-elicitation-prompt.tsx), [`packages/tui/src/routes/session/index.tsx`](../../packages/tui/src/routes/session/index.tsx#L225), [`packages/apexo/src/cli/cmd/run/footer.view.tsx`](../../packages/apexo/src/cli/cmd/run/footer.view.tsx#L176) |
| App/Desktop dock and composer integration | [`packages/app/src/pages/session/composer/session-mcp-elicitation-dock.tsx`](../../packages/app/src/pages/session/composer/session-mcp-elicitation-dock.tsx), [`session-composer-state.ts:38`](../../packages/app/src/pages/session/composer/session-composer-state.ts#L38) |

## Non-blocking observations

These were reproduced, are not acceptance failures, and do not require architecture changes. No production fix was applied in this audit.

### O1 — App/Desktop: Enter in a text field submits the whole form with defaults

- Scope: browser App and rebuilt Desktop (same App code).
- Reproduction: open a live form, focus the `Name` text input, press Enter.
- Observed: the form closes and the tool receives `accept` with `{"name":"sample","quantity":2,"ratio":0.5,"confirm":false,"environment":"dev","regions":["a"]}`.
- Cause: the dock is a real `<form>` with implicit submission enabled; the TUI instead uses Enter to advance to the next field.
- Assessment: the plan's "explicit submit" requirement is still met for pointer users, and defaults are never auto-submitted, but Enter semantics differ between surfaces and can accept untouched defaults in a multi-field form.
- Minimal options: decide the product behavior. To align with the TUI, intercept Enter in text/number editors and move focus; to keep implicit submission, state it in the dock copy. Do not implement both.

### O2 — App/Desktop: field constraints render above the field label

- Location: constraints loop at [`session-mcp-elicitation-dock.tsx:130`](../../packages/app/src/pages/session/composer/session-mcp-elicitation-dock.tsx#L130) precedes the label at [line 135](../../packages/app/src/pages/session/composer/session-mcp-elicitation-dock.tsx#L135).
- Observed: in the acceptance screenshot, `Minimum value: 0` and `Maximum value: 1` appear above `Ratio`, so they read as belonging to the previous field.
- Assessment: constraints are displayed as required, but the association is ambiguous. The TUI order (title, constraints, input) is clearer.
- Minimal fix: move the constraints loop below the label. No data or Core change is needed.

### O3 — Dead export after the hydration repair

- Location: [`session-request-tree.ts:3`](../../packages/app/src/pages/session/composer/session-request-tree.ts#L3).
- Observed: `sessionTreeIDs` is still exported, but after the repair the composer watcher uses the viewed Session plus `includeDescendants`; only the internal `sessionTreeRequest` helper calls it.
- Assessment: cosmetic cleanup only. Removing the `export` keyword does not change behavior.

## Checked and not reproduced

- No page hang, white screen or unresponsive surface in mini/fullscreen PTY, Chrome or Electron.
- No browser page errors or console output during a full form flow.
- Empty required number: the submission is rejected (Core validation is mapped to 400 by the handler), the form remains pending, the field gets `aria-invalid="true"` and an inline alert; correcting it completes the call.
- Prototype-named optional fields (`toString`, `valueOf`, `isPrototypeOf`): absent by default, typed correctly when explicitly edited; raw UI reads do not expose inherited values.
- Cross-Session, nested Task, cross-worktree, unrelated-Session exclusion and owner-only replies.
- Frontend reload hydration, backend restart clearing, stale reply 404 and no provider replay.
- Duplicate same-action replies and conflicting-action 409.
- Session interrupt closing the owned form and producing an errored tool result.
- Headless, inherited headless, scheduled and scheduled-descendant rejection; ordinary interactive child acceptance.
- Per-server `elicitation: false` opt-out preserving both native and compatibility configuration loading.
- Sessionless HTTP without `mcp-session-id`, stateless stdio, and stateful continuity.
- The backend warning seen during API acceptance was the expected strict-payload rejection for `{ action: "decline", unexpected: true }`, not a defect.

## Design scope / over-engineering assessment

The implementation stays within the planned mechanisms:

- It reuses the existing Location-scoped shared MCP Client, the `QuestionV2` Deferred pattern, the existing dock containers and Session lifecycle.
- `McpCall` is a focused gate/budget/ownership boundary, not a second execution engine.
- Descendant hydration reuses the existing pending-list endpoint with one query flag instead of adding tables, routes or a frontend discovery framework.
- The App already had Session tree traversal for permission/question lookup; the repair intentionally does not expand that framework for forms.

One tradeoff worth knowing: the UI uses the live list watcher on a 1.5-second poll instead of subscribing to the published `mcp.elicitation.*` events. This is functionally correct and simple, but adds up to 1.5 seconds of display latency and periodic requests. It is not a defect and does not justify a redesign in this scope.

## Merge status and next steps

- Draft PR #207 remains open on `mcp-forms` and was not merged, pushed or amended during this audit.
- The required `typecheck` and `unit (linux)` checks still gate merge; local gates passed at the reviewed commit.
- If the team wants to close O1/O2, both are small UI-only changes; the TUI already demonstrates the intended field ordering and Enter behavior.
- If either observation is fixed, create the corresponding record under `docs/testing/` per `AGENTS.md` and link it from this audit. This document intentionally does not claim a fix or a recurrence count.

## Follow-up repair of O1–O3

The audit above describes commit `f26259af`. The subsequent repair chooses the field-navigation option for O1: Enter in an input advances to the next enabled control, and the final input focuses Submit. Explicit button activation still accepts the form, and composing Enter does not move focus. O2 moves the existing constraints below their own label. O3 removes only the unused export from `sessionTreeIDs`; the existing permission/question lookup continues to use the internal helper.

The browser regression failed on the audited build at the first Enter-to-next-field assertion. The expanded real browser acceptance passed 20 checks; rebuilt Desktop with its own authenticated sidecar passed 21. The native field-navigation and explicit-button paths returned the exact expected typed tool reply. Root typechecking passed all 21 tasks. The full 522-file unit gate and both generated-code checks also passed. All three HTTP modes passed 358 scenarios with zero failures or skips, completing all five local gates. The production composer medians were 170.5/178 ms before/after (+7.5 ms), with reported tails of 181/214 ms. Full samples and the limitations of one paired comparison are in [the performance record](../testing/performance/mcp-form-composer.md). The corresponding bug records are [input navigation and field ordering](../testing/ui/mcp-form-interactions.md); final results will be recorded in [the implementation checkpoint](f04-implementation.md). PR #207 remains a draft and is not merged.
