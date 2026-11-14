# F02 contextual permission review audit

Date: 2026-11-13, Asia/Singapore. Audited revision: `6f6f5b99a649f12cb7e959dc949fa17293839796` on `permission-review`; base `70a9f0d4`. Scope: section 6 and A01–A10 of [the agreed plan](codex-first-batch-plan.md), with actual terminal, Desktop and generated-client verification.

**Conclusion: F02's main implementation is present, but it is not completely accepted. Three confirmed defects remain, including one P1. Fix them before merging.**

The implementation [PR #208](https://github.com/cluster1900/apexo-code/pull/208) remains draft and unmerged. Its required `unit (linux)` and `typecheck` checks pass at the audited head. Those checks do not cover the additional failures below. This audit changes documentation and evidence only; no business code, commit, push or merge was made.

## Confirmed findings

| Priority | Finding | Evidence | Minimal correction |
| --- | --- | --- | --- |
| P1 | Scope capture can execute a repository Git wrapper before permission is granted. | A real native tool with cwd `repository/package` and executable `repository/bin/git` ran the wrapper 18 times while permission was still `ask_manual`; the reviewer returned `ask` and no manual reply was sent. `review-context.ts:144` checks only cwd containment, then `gitScope` executes that untrusted path. [BUG-20261113-F02-001](../testing/permissions/native-permission-review-audit.md#bug-20261113-f02-001-scope-capture-executes-an-unapproved-repository-git-wrapper). | Establish a trusted executable before running scope queries; unresolved or workspace wrappers stay manual without execution. |
| P2 | Fullscreen reconnect preserves the old review mode after backend reset. | Actual production providers fetched manual/revision 0 after previously showing review/revision 3, yet still rendered review. `context/permission.tsx:34` rejects the lower revision; reconnect at line 52 does not clear old state. [BUG-20261113-F02-002](../testing/ui/native-permission-review-audit.md#bug-20261113-f02-002-fullscreen-mode-cache-rejects-a-new-backend-incarnation). | Reset the incarnation-scoped cache at reconnect and apply authoritative mode, following the existing App pattern. |
| P2 | Default fullscreen mixed-host attachment does not enable native backend review. | A real PTY attached to an established native Session displayed `Auto-review on`, while GET still returned manual/revision 0. Server-wide legacy health selects compatibility in `transport/session.ts:16`, so the toggle remains frontend-local. [BUG-20261113-F02-003](../testing/ui/native-permission-review-audit.md#bug-20261113-f02-003-default-mixed-host-attachment-leaves-native-review-on-the-compatibility-path). | Select the native path for established native Sessions using existing identity evidence; retain compatibility for V1 and explicit compatibility selection. |

All three remain unfixed at this revision. No new subsystem, review history table, protocol endpoint or general shell interpreter is needed for these corrections.

## Cross-surface result

| Surface | Implemented and freshly verified | Remaining limitation |
| --- | --- | --- |
| Core and native HTTP | One backend owner, user-origin evidence, static policy precedence, one-shot tool-free review, bounded failures, invalidation, single settlement and inline pending state. Focused 41 tests / 244 assertions; pure/mixed HTTP 2 tests / 42 assertions. | The unapproved wrapper execution invalidates the read-only scope boundary. |
| Mini TUI | Native `/auto`, reviewing status, manual approval while streaming, fallback reason and disabling mode: 5 real PTY checks passed. Explicit native selection on a mixed host: another 5 passed. | The default mixed mini supplementary probe timed out and is inconclusive; it is not counted as accepted. |
| Fullscreen TUI | The same 5 ordinary native PTY checks passed; explicit native selection on a mixed host passed another 5. Stable permission root and active manual controls are implemented. | Default mixed-host selection and backend-incarnation rehydration fail as above. |
| Browser App | 8 production checks passed; mixed-host App passed 10. Two connected clients share one review, reload retains pending review, manual controls remain enabled and full-auto stays distinct. | No independent App defect confirmed by these cases; Core scope defect also affects it. |
| Desktop | A real Electron window using its own authenticated sidecar passed 8 checks, including backend toggle, reload, reviewing/manual controls, fallback and approval. Renderer shares the implemented App flow. | This audit reused the previously rebuilt Desktop artifact from this source revision; it did not perform a new build. Core scope defect also affects it. |
| Client Promise | Real HTTP GET/PUT, mode/start/settle SSE events, permission list/get inline status and reason, and manual reply all passed. | No generated Promise-client F02 defect found. |
| Client Effect | Real HTTP mode GET/PUT, mode/start/settle event streaming, pending list/get and manual reply all passed. Uses Schema/Protocol contracts without a Core/Server runtime dependency. | No Effect-client F02 defect found. |
| Legacy JS SDK | `client.v2.session.permissionReview.get/set` shares the same backend state; native UI paths also exercise the regenerated SDK. | No SDK F02 defect found. |

## A01–A10 assessment

| ID | Assessment | Evidence and boundary |
| --- | --- | --- |
| A01 | Implemented; tested ordinary precedence | Static allow/deny bypass reviewer. Existing inherited/saved/headless authority remains before native review and is rechecked before applying an approval. This audit did not add a separate exhaustive inherited-denial matrix. |
| A02 | Pass for tested scope cases | Matching publication to isolated local bare repositories, force and wrong-remote fallback, and changed HEAD rejection pass. Controlled model decisions establish orchestration rather than real-model judgment quality. |
| A03 | Partial | Non-user origins never become verified instructions; external metadata cannot fabricate runtime ownership. The custom executable can nevertheless run during capture before any permission decision. |
| A04 | Pass for tested cases | Unknown/imported/schedule/task/workflow inputs, queued/withdrawn inputs and copied history are excluded by the canonical input/effective-context selector. |
| A05 | Pass for tested races | Admission and mode changes invalidate held review streams; final settlement uses the admission fence and Session gate. |
| A06 | Pass for tested races | Manual once/reject, Session interrupt and sibling rejection revoke late results and complete cleanup without deadlock. |
| A07 | Pass for tested failures | Timeout, provider/503 failure, malformed response, unknown citation and oversized input fall back to manual. Reviewer transport retries are zero; normal retry behavior remains covered. |
| A08 | Partial | Browser, mixed App, own-sidecar Desktop, explicit native mini/fullscreen and two-client/reload flows pass. Fullscreen new-incarnation state and default mixed attachment fail. |
| A09 | Pass for tested event paths | Origin survives admission, exact retry, promotion, both projector paths and replay; absent old-event origin remains unknown and copy/fork does not gain trust. Existing Task/Workflow/Schedule ingress assertions remain in the implementation suite. |
| A10 | Partial | Literal shell/cwd facts, Git defaults/overrides, credential redaction, unsupported opaque commands and changed scope tests pass. Workspace-wrapper validation uses the wrong containment boundary and permits pre-approval execution. |

## Fresh checks and limits

Commands were run from `packages/apexo` unless noted otherwise. Tests launched and cleaned their own isolated fixtures; no existing user app or server was restarted.

- `bun test test/v2/permission-review.test.ts test/v2/permission-review-scope.test.ts test/v2/doctor-and-v2-hardening.test.ts test/event-manifest.test.ts`: **41 passed, 244 assertions**.
- `bun test test/e2e/v2-permission-review.e2e.test.ts`: **2 passed, 42 assertions**.
- `bun script/permission-review-tui.mjs` and `--fullscreen`: **5 checks each**.
- `bun script/permission-review-ui.mjs browser`, `mixed`, `builtin`: **8 / 10 / 8 checks** respectively.
- Supplemental real-client integration: **12 checks passed** across Client Promise, Client Effect and legacy SDK, including all three canonical review event types.
- Supplemental mixed-host PTY with explicit native transport: **5 checks each** for mini/fullscreen. Default mixed fullscreen fails the backend-mode assertion; default mixed mini timeout remains inconclusive.
- Supplemental direct-scope and native-runner wrapper assertions both fail. One production-provider reconnect render assertion fails. These supplementary failures establish the three findings and must not be hidden by ordinary-flow passes.
- The initial native-runner audit harness used an incorrect Location-service helper and was corrected before obtaining valid evidence; the first harness error is excluded from product findings.

The full unit, typecheck, generated-source and HTTP gates in [the implementation report](f02-implementation.md) were previously run at this code snapshot; they were not repeated wholesale for this documentation-only audit. Current PR required checks were directly queried and are green. No live-model judgment benchmark, Windows/Linux GUI run or signed-installer certification is claimed. The optional model evaluation script is not a missing mandatory deliverable.

[Normalized evidence](f02-audit-evidence.json) retains the observed states without credentials or temporary paths. Recommended next step: make the three bounded corrections and rerun their affected scope/terminal cases before merging.

## Remediation (2026-11-14)

The three findings above describe `6f6f5b99`; their original failure evidence is preserved. Follow-up changes on `permission-review` correct each at the existing boundary:

| Finding | Correction and fresh evidence |
| --- | --- |
| Pre-approval wrapper execution | Canonical executable checks cover enclosing repositories, not just the effective cwd. Git scope queries require the backend's installed Git identity before invocation. Explicit/PATH wrappers in repository siblings and outside the repository remain manual without running. A real native runner regression verifies no marker and no reviewer call. |
| Fullscreen reconnect mode | Clear old mode state on reconnect and reject previous-connection responses; preserve revision ordering within the current connection. Actual provider rendering verifies manual revision 0 and the next `/auto` toggle correctly enabling review. |
| Mixed-host terminal routing | Existing automatic transport selection consults the selected Session's canonical history. Fullscreen and mini startup provide the resolved ID; explicit compatibility still wins and history errors cannot silently change engines. Real mixed mini/fullscreen each pass 5 checks using the default protocol option. |

The combined focused command now passes **66 tests / 360 assertions**. Browser/mixed App checks pass **8 / 10**, and Client Promise/Effect/SDK integration passes **12**. Rebuilt Desktop and complete-gate results are recorded in [the implementation report](f02-implementation.md) after the final runs. No new API, persistence table, dependency or orchestration layer was introduced.
