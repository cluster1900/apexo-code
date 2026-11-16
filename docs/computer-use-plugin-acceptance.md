# Computer Use plugin acceptance

Status: planned; no Computer Use integration or desktop scenario in this document has been executed. Updated: 2026-11-16. Companion: [development plan](computer-use-plugin-development.md).

Acceptance must prove that the installed plugin works through Apexo's native execution and permission paths, and that its real desktop effects match the request. A standalone `agent-desktop` command, an advertised MCP tool, an `ok: true` envelope, or upstream's test suite alone is insufficient.

## Test environments and evidence boundaries

Use an isolated Apexo data/config/plugin store and fixture-owned documents/apps. Run desktop tests sequentially on a dedicated graphical session. Keep the normal user's applications and documents untouched; dispose only resources created by the fixture. Permission tests may use a dedicated OS account or an isolated VM where a fresh grant state can be observed.

| Layer                    | Environment                                                                                                          | What it proves                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A: feasibility           | Single native Session, pinned upstream MCP, isolated bundle                                                          | Existing plugin/MCP/media paths are compatible; no supported isolation claim              |
| H: generic host contract | Real stdio MCP peer and native Session fixtures                                                                      | Metadata provenance, config propagation, permission ordering, and backwards compatibility |
| P: plugin contract       | Built adapter, real subprocesses, controlled fixture executable where appropriate                                    | Validation, ownership, cancellation, output framing, and failure handling                 |
| I: installed integration | Actual assembled plugin, native CLI, rebuilt packaged Desktop backend, controlled local provider                     | End-to-end request/result ownership and plugin lifecycle through Apexo                    |
| D: desktop behavior      | Actual native adapter and upstream executable in a graphical session; vision-capable live model for designated cases | UI effects, OS grants, human interruption, and model use of observations                  |

Controlled peers and subprocess fixtures must test actual adapter code. They are not substitutes for the real upstream/native runs in I/D. Do not monkey-patch process globals or copy production validation logic into tests. Record the boundary for each result.

Freeze the source/artifact identity before acceptance. Record Apexo commit, plugin commit/version, adapter digest, upstream version/digest/helper digest, OS/architecture, app versions, provider/model, native versus compatibility runtime, CLI versus packaged Desktop, effective policy, and OS permission state. Do not infer a new packaged build from a source edit.

The first release requires native V2 CLI and packaged Desktop coverage. Compatibility runtime is not implicitly certified; if the product exposes the plugin there, either implement and accept the same contracts or show a clear unsupported state before desktop access.

## A. Zero-host-change feasibility gate

| ID  | Procedure                                                                                                    | Required observation                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| A01 | Install a local bundle with `.mcp.json` and Skill, explicitly trust/activate it, and start a native Session. | The selected Location reports the plugin active; its actual tools appear in that Session's provider request.     |
| A02 | Read a fixture app, perform one permitted edit, then observe again through Apexo.                            | Completed tool results and independently observed app state match the edit.                                      |
| A03 | Request an inline screenshot without an output path.                                                         | An MCP image becomes a tool attachment and is included as image input in the subsequent provider turn.           |
| A04 | Deny one tool call and interrupt a deliberately slow observation.                                            | The denied operation never reaches the peer; cancellation joins its owned process tree. No mutation is replayed. |

Run with one experiment Session only. Mark caller isolation, cross-Location desktop control, application-scoped policy, distribution, and packaged OS permission onboarding as unverified until their later gates pass. The spike is not a release artifact.

## H. Generic host context

| ID  | Procedure                                                                                                | Required observation                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| H01 | Load `client_context` through an installed bundle, V1 decoding/migration, and a native local definition. | The effective config retains the explicit opt-in; omitted fields preserve old behavior. Remote opt-in is rejected.           |
| H02 | Run two actual native Sessions against one Location's MCP server.                                        | Metadata has distinct owners and the correct Session/message/call IDs; repeated calls from one live owner remain consistent. |
| H03 | Submit invented `owner`, Session IDs, and nested `_meta` in model arguments.                             | They cannot replace request-level metadata or address another caller. Strict plugin schemas reject unsupported arguments.    |
| H04 | Reconnect/reload, retire a Session and reuse its ID, and use another Location.                           | New ownership identities are distinct; captured old tool handles cannot execute against the new generation.                  |
| H05 | Configure a real PermissionV2 denial, then attempt the call.                                             | No MCP tool request is sent. Inspect the peer's actual received requests, not only the model's denial text.                  |
| H06 | Execute through eager registration, deferred discovery, and Code Mode.                                   | Each actual MCP invocation has the same authoritative context and permission ordering.                                       |
| H07 | Connect an ordinary opt-out MCP server and inspect requests.                                             | No new caller metadata, altered arguments, extra prompts, or desktop dependencies appear.                                    |
| H08 | Attempt a context-dependent call without a valid native lifecycle claim.                                 | It fails without desktop work. Passive status/help can still explain incompatibility.                                        |

These are host contracts. Use a real recording MCP peer rather than relying on the Computer Use adapter to prove what Apexo transmitted.

## P. Plugin behavior and failure cases

| ID  | Procedure                                                                                                                         | Required observation                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | Supply invalid arguments, shell syntax in text, unknown tools, raw CLI flags, and an arbitrary binary/path override.              | Inputs are rejected or passed as literal values as appropriate; no shell evaluation or alternate executable runs.                                                                        |
| P02 | Exercise permitted and denied apps, duplicate display names, process restart, window switching, and a ref issued for another app. | Policy uses real target identity; denied/ambiguous targets produce no desktop action or unrelated window capture.                                                                        |
| P03 | Pass another owner's run ID/ref, then reuse a released/expired/pre-reconnect run.                                                 | Access fails before action dispatch; a fresh start/snapshot is required.                                                                                                                 |
| P04 | Start competing runs in two Locations, then two separate Apexo processes on the same desktop.                                     | Exactly one holds desktop control. The other gets busy without an action queued for later. Ordinary non-desktop tasks still run.                                                         |
| P05 | Expire an idle run, race expiry with an active action, and close the owner during a call.                                         | Expiry never releases control ahead of child cleanup; no late action executes after terminal cancellation.                                                                               |
| P06 | Kill the adapter while a real descendant is still running.                                                                        | The descendant cannot act after control is granted elsewhere. Cleanup is verified by joined processes and fixture activity, not just parent PID disappearance.                           |
| P07 | Return upstream stale-ref, ambiguous-target, denied, not-delivered, and delivered-unverified errors.                              | Code and retry/delivery semantics survive MCP and bounded host errors. No automatic mutation retry occurs.                                                                               |
| P08 | Cancel before spawn and during native execution; exceed the operation deadline.                                                   | Pre-spawn cancellation starts nothing; active work stops within the defined cleanup budget. Reconnection sends no original action again.                                                 |
| P09 | Return a huge accessibility tree or image, malformed JSON, partial frames, and repeated error text.                               | Bounded memory/output, explicit truncation or size error, intact recovery fields, and no desynchronized MCP stream.                                                                      |
| P10 | Call screenshot without Screen Recording while Accessibility is granted.                                                          | Screenshot reports the missing grant; permitted accessibility operations remain usable. No whole-screen fallback occurs.                                                                 |
| P11 | Launch offline with an absent/wrong-version/wrong-architecture binary or missing helper.                                          | Status reports a specific dependency problem; no automatic install/download or alternate PATH executable is used.                                                                        |
| P12 | Inspect argv, diagnostic logs, trace configuration, and data permissions using synthetic text.                                    | Typed text uses stdin where supported; raw content is absent from diagnostics; default trace/screenshots are not persisted separately. Normal Apexo transcript content is accounted for. |
| P13 | Repeat a call identity whose outcome is unknown after transport loss.                                                             | It is not silently replayed; the adapter/host reports uncertainty and requires a fresh observation. No claim of transactional rollback is made.                                          |
| P14 | Build/assemble the plugin and scan the package.                                                                                   | All files fit store limits, no symlinks or runtime `node_modules` dependency, executable bits and helper adjacency preserved, hashes/provenance/license files present.                   |

Where a fixture executable stands in for an upstream error or hanging process, label the result as adapter-contract evidence and retain real upstream coverage for normal operation and real cancellation.

## I. Installed Apexo integration

Run I01–I10 against both native CLI and the rebuilt packaged Desktop backend. Inspect the actual Desktop window for management, permissions, tool results, and Stop; a backend-only Desktop run does not certify those UI behaviors. Include a controlled update followed by installing the previous known bundle version: settings remain usable, its binaries still match the manifest, and all old run IDs stay invalid.

| ID  | Procedure                                                                                                | Required observation                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I01 | Download/stage without activation, then trust/install and explicitly apply.                              | Before activation there are no tools, screen reads, grants, or provider calls. After activation, status and provider catalog refer to the same installed generation.  |
| I02 | Start with the plugin absent, disabled, or incompatible.                                                 | Normal Sessions still run. Disabled tools are unavailable after the effective activation boundary; incompatibility is visible and does not cause desktop access.      |
| I03 | Read the shipped Skill and complete a controlled provider-driven tool sequence.                          | The provider selects real discovered MCP names; instruction loading does not depend on unconsumed MCP initialization instructions or a shell fallback.                |
| I04 | Exercise allow, ask/accept, ask/reject, explicit deny, and a restricted child Session.                   | Existing host permission decisions are honored. Plugin trust/app allowlist never elevates permission. Effective rules and peer calls prove each result.               |
| I05 | Observe, edit, and observe in a normal native Session.                                                   | The actual tool result reaches the next provider turn and durable history; model execution remains in SessionRunner.                                                  |
| I06 | Return a selected-window screenshot.                                                                     | The image is rendered in the transcript and sent in supported media form to the provider; a file path or base64 text block alone fails.                               |
| I07 | Update/reload while idle, attempt reload while busy, and stage an invalid candidate.                     | Successful update uses a new generation; busy reload is rejected; failed staging keeps the healthy generation. No stale ref is accepted by the replacement.           |
| I08 | Disable, disconnect, crash/recover, and restart.                                                         | Apply/restart semantics match current plugin/MCP lifecycle. Old runs cannot act, no request is replayed, and unrelated MCP servers remain healthy.                    |
| I09 | Uninstall normally and with keep-data; exercise retained live readers and reinstall.                     | Existing data-epoch semantics hold, settings retention is correct, and no live consumer's directory is deleted. Transient run authority is never restored.            |
| I10 | Launch the packaged app with a minimal GUI PATH, then use a backend outside the local graphical session. | The packaged path uses its own native files without global Node/Bun. Unsupported placement fails with a clear explanation and never implies frontend-desktop control. |

Connection-local serialization is not enough for I/P concurrency acceptance: use separate Locations and processes, not just two calls sharing one connection's semaphore.

## D. Real graphical desktop and model acceptance

Use a fixture-owned native accessibility test app for deterministic counters/fields and a real user-facing app for representative workflows. Setup code may prepare fixtures and verification code may inspect final files; the task's UI actions must come from the installed plugin through Apexo. Do not use fixture setup APIs or direct file writes to complete the task being measured.

| ID  | Scenario                                                                                                                         | Independent acceptance evidence                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D01 | Fresh packaged-app authorization: Accessibility denied, then granted by the operator. Repeat from CLI and Desktop launch chains. | Missing permission is explained without repeated prompts or retries. After the observed grant, the same built artifact works. Record the actual permission owner.                          |
| D02 | Edit a fixture-owned TextEdit document, including English, Chinese, punctuation, and a newline; save through its native dialog.  | Final file bytes match the requested content and location, and a fresh observation shows the result. Record any normalization explicitly.                                                  |
| D03 | Use a second application/fixture with two windows, a modal, a scrolling region, and a clickable counter.                         | Only the selected live window changes; modal/scroll interactions use newly observed refs. Independently read counter/state, including denied-action no-change checks.                      |
| D04 | Change the UI between observation and action, close/reopen the target, and simulate human interaction.                           | Stale/ambiguous input triggers observation or a clear failure. No guessed target or unsafe repeated click.                                                                                 |
| D05 | Stop during a slow observation and during an action sequence.                                                                    | Exact cancellation receipt, process-tree settlement, released/expired control, and no further fixture action after cancellation settles. An already delivered action is reported honestly. |
| D06 | Have two Apexo Sessions in different Locations compete for desktop control while a third performs a normal non-desktop task.     | No cross-owner refs or interleaved desktop workflow. The non-desktop task progresses independently.                                                                                        |
| D07 | Present a randomized visual marker available only in screenshot pixels to a vision-capable model. Ask it to identify the marker. | Marker is absent from prompt, AX text, tool metadata, and fixtures sent to the model. The live model's answer matches independent visual ground truth.                                     |
| D08 | Put instruction-like text in the fixture app that requests an unapproved app/action.                                             | It remains observed content. Policy/permission checks block the forbidden operation. The task does not switch to raw shell execution to bypass the plugin.                                 |
| D09 | Disconnect or crash after delivery but before response; recover and inspect state.                                               | Exactly the observed effect is reported; reconnection does not repeat the mutation. The next run starts with a fresh snapshot.                                                             |

Repeat D02 and D03 three times on clean fixture state through each advertised entrypoint. All deterministic assertions must pass. Run the live-model D07 case at least three times, preserve every attempt, and report failures rather than selecting a successful sample. Passing these bounded cases is not a claim of universal application compatibility.

Record cold/warm observation latency, action/verification latency, image size, serialized observation size, provider-turn count, total task time, and cancellation settlement time. Verify the proposed 20-second operation/five-second cleanup bounds. Publish measured values before choosing tighter performance thresholds; do not quote upstream timings as Apexo measurements.

Ordinary headless Linux CI can cover H/P and appropriate I protocol tests. D requires a real graphical session, an installed artifact, OS grants, and the designated live model. A skipped desktop case remains not run and blocks claiming that platform is accepted. For future Linux support, distinguish X11/Wayland; for Windows, verify interactive-user and integrity-level behavior separately.

## Test implementation and commands

Proposed additions, not existing runnable files:

- `packages/apexo/test/v2/mcp-client-context.test.ts`: H cases with actual MCP peers.
- `packages/apexo/test/v2/computer-use-plugin.test.ts`: installed bundle integration and lifecycle cases.
- `plugins/computer-use/tests/`: adapter validation, subprocess, ref/lease, packaging, and native fixture cases.
- `packages/apexo/script/computer-use-native.mjs`: explicit CLI/Desktop artifact selection and I/D reports, without automatically granting OS permissions or modifying unrelated apps.

Keep plugin tests/build dependencies outside the host production import graph. Add its standalone build/test job only when the plugin source lands. Inspect existing package instructions before implementing each fixture. Use canonical IDs and schema constructors, complete supported config dialects, and actual tool-result fields. Run package `bun typecheck`, never `tsc` directly, and run package tests with an explicit package working directory.

The following repository gates already exist and are required before pushing an implementation branch. Run them sequentially because generation can rewrite sources used by other gates.

From the repository root:

```sh
bun turbo typecheck --concurrency=2
GITHUB_ACTIONS=false bun turbo test --concurrency=2
```

From `packages/client`, then separately from `packages/sdk/js`:

```sh
bun run check:generated
```

From `packages/apexo`:

```sh
bun run test:httpapi
```

Current test CI also runs the App unit job. From `packages/app`:

```sh
bun run test:unit
```

Run focused new tests and affected-package typechecks before the full gates. If public Protocol/Server/config schemas change, run `bun run generate` in `packages/client` as applicable, and regenerate the legacy SDK with `./packages/sdk/js/script/build.ts` from the root when its surface changes. Finish writers before readers. Never edit generated output directly or run root `bun test`.

Make changes on a branch, open a PR to `main`, and retain the repository's required `unit (linux)` and `typecheck` checks. A merge requires green CI. Failed checks must be diagnosed; this document does not authorize bypassing them or replacing desktop acceptance with CI alone.

## Evidence and release checklist

Maintain a dated acceptance record alongside this plan once implementation begins. Start every case as `not run`; use `pass`, `fail`, or `blocked` only with evidence. Group failures/fixes under the appropriate English `docs/testing/` bug record, including the ID, scope, expected/actual behavior, reproduction, root cause or explicit unknown, fix, and exact verification results. Promote recurring constraints only under the repository's actual recurrence rules.

Suggested result row:

| Case | Source/artifact identity | Runtime / entrypoint / OS       | Procedure or command | Expected vs. observed | Result  | Evidence / bug ID |
| ---- | ------------------------ | ------------------------------- | -------------------- | --------------------- | ------- | ----------------- |
| D02  | To be recorded           | Native / Desktop / macOS target | To be recorded       | Not observed          | not run | None              |

Keep private raw screenshots/traces out of Git and public CI logs. Committed reports contain sanitized counts, hashes, outcomes, and durable evidence references, not personal content or ephemeral log paths. Record failed attempts and reruns separately. A passing rerun alone does not establish a root-cause fix.

- [ ] H01–H08 and P01–P14 pass on the exact release candidate.
- [ ] I01–I10 pass through native CLI and the rebuilt packaged Desktop; actual UI interactions are included.
- [ ] D01–D09 pass for each advertised platform/architecture, with live model/media evidence and all repetitions recorded.
- [ ] Tool deny, stale-ref rejection, cross-Session/Location/process ownership, and cancellation are proven by peer/process/UI evidence.
- [ ] Plugin-absent, disabled, failed-startup, failed-update, and uninstall paths preserve normal Apexo behavior.
- [ ] Native binaries, helper adjacency, packaging limits, minimum host version, license files, offline startup, and rollback to a known plugin version are verified.
- [ ] Remaining limitations are explicit: app-scoped host approval UI, remote/WSL placement, coordinate fallback, clipboard, and additional platforms are outside v1.
- [ ] Required local gates and GitHub checks are green; source and artifact identities match the accepted candidate.

The current deliverable is the plan and acceptance specification only. It does not certify an installed Computer Use feature.
