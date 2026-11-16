# Computer Use plugin acceptance

Status: implementation acceptance in progress. Executed results, failed attempts, artifacts, and unrun conditions are recorded in the [implementation acceptance record](development/computer-use-acceptance.md). Reviewed: 2026-11-16.

This verifies the direct upstream MCP integration described in the [development plan](computer-use-plugin-development.md). The accepted scope is a local macOS user, one desktop task at a time, through native V2 CLI and packaged Desktop. It does not certify concurrent workflow isolation, application confinement, confidential text entry, or remote frontend control.

The 18 cases below replace tests for the removed caller-context extension and custom adapter. Reuse existing generic MCP/lifecycle suites rather than creating another transport test framework. Passing upstream tests alone is not evidence that Apexo's installed plugin works.

## Setup and evidence

Record Apexo commit, plugin version, upstream version and executable/helper digests, OS/architecture, target app versions, provider/model, effective permissions/review settings, and OS grants. Select the actual native CLI and rebuilt packaged Desktop artifacts explicitly. A source change or backend-only run does not establish that the Desktop UI was tested.

Use disposable fixture documents and a fresh test Session without saved approvals. Configure global denial for the plugin server and exact selected-tool exceptions before activating desktop work. Verify the resulting policy; the built-in build agent otherwise has wildcard allow. Do not insert native fields into a legacy configuration document.

Run bundle checks once per release artifact. Run integration and graphical cases through each advertised entrypoint. Headless CI can cover packaging and transport/provider fixtures; it cannot certify OS grants or real desktop actions. Existing host tests may supply generic lifecycle evidence, but the actual packaged bundle must cover launch, activation, tool/result delivery, cancellation, and uninstall.

## B. Bundle and launch

| ID  | Procedure                                                                                   | Required observation                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01 | Assemble and inspect the actual platform bundle.                                            | Executable/helper versions match; hashes, origin, license files, executable bits, and adjacency are correct. No symlinks, runtime `node_modules`, or PluginStore size-limit violations.                                                                                                                                                                  |
| B02 | Start offline with a minimal GUI PATH from native CLI and packaged Desktop.                 | The adjacent native binary runs without globally installed Node/Bun or downloads. MCP stdout contains only protocol traffic; handshake and tool discovery succeed.                                                                                                                                                                                       |
| B03 | Try a missing helper, missing/wrong-architecture executable, and a corrupted staged bundle. | Assembly rejects invalid artifacts or startup/first affected operation reports an actionable failure. No fallback executable or silent download runs; ordinary Apexo work remains available. Failed MCP preparation retains the previous generation; a helper error detected only during tool execution is reported without claiming automatic rollback. |
| B04 | Reconnect, restart, and open a second Location sequentially.                                | Each launcher process has a different upstream namespace; a ref from the previous namespace fails in the new one. State is under the private plugin data epoch, no trace manifest is created, and retained refmaps are documented. This is connection separation, not Apexo Session ownership.                                                           |

## I. Installed integration

| ID  | Procedure                                                                                                                 | Required observation                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I01 | Install/trust and activate the real bundle; also start with it absent or disabled.                                        | Active status and discovered tools reflect the effective generation. Management alone triggers no provider work, screen read, or OS grant prompt. Normal Sessions work without the plugin.                                                                                       |
| I02 | Load the recommended profile and inspect decisions for the selected agent, another agent, and a restricted child Session. | The selected tools use the intended approval path. Administrative/composite tools and tools without explicit exceptions are denied. Later config/saved rules or automatic review must not silently invalidate the advertised setup; record their actual effects.                 |
| I03 | Exercise explicit deny, ask/reject, ask/accept, and an explicit test-only allow.                                          | Deny/reject sends no MCP tool request; accepted/allowed requests execute once. Prove dispatch using a real recording MCP peer at the host boundary and verify no UI change for a denied real desktop action. A model saying it refused is insufficient evidence.                 |
| I04 | Load the installed Skill and run observe/action/observe through a normal native Session.                                  | The provider receives actual discovered tool names, results, and durable history. Apexo's SessionRunner owns the loop. Cover the default exposure mode and any deferred/Code Mode configuration advertised by this plugin profile.                                               |
| I05 | Request an inline screenshot without an output path.                                                                      | It becomes a displayed tool attachment and supported image input in the next provider request. A path or base64 text alone fails. Use a recording provider for transport evidence; D06 separately proves live-model consumption.                                                 |
| I06 | Cancel or time out a running call, then test transport loss and recovery.                                                 | Existing deadlines settle the call, the actual process tree is cleaned up, and reconnect sends no original mutation again. An uncertain outcome is reported as uncertain. Use a controlled peer for precise timing and the real native path for D05.                             |
| I07 | Update/reload while idle, attempt reload while busy, then disable and restore a previous bundle.                          | Existing activation boundaries hold; busy reload is rejected, failed preparation preserves the prior generation, and disabled tools disappear after apply/restart. Successful replacement uses a fresh namespace and requires new observations. Other MCP servers remain usable. |
| I08 | Uninstall normally and with keep-data, then reinstall after consumers stop.                                               | The plugin is unavailable at the documented lifecycle boundary. Data retention/deferred cleanup follows the existing plugin data contract; live consumers lose no data prematurely. Reinstall creates a fresh connection namespace even when old files are retained.             |

Use a recording peer only to prove host transport/permission behavior, not as a replacement for the installed upstream binary. Reuse existing host tests for malformed frames, output bounds, and process-group cleanup; add a regression only when integration exposes an uncovered failure. Inspect actual fields and process/UI effects, not historical argument markers or parent PID disappearance alone.

## D. Real graphical and model behavior

Use TextEdit and Calculator or similarly accessible, pre-opened applications. A small generated image is sufficient for visual reasoning; a new native fixture application is not required. Setup may create fixtures and independent checks may read results, but all UI actions completing the measured task must flow through the installed plugin. Do not complete the task using shell commands or direct file writes.

| ID  | Procedure                                                                                                                                                                        | Required observation                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Test missing and granted Accessibility, and missing and granted Screen Recording, through each actual launch chain.                                                              | Permission status/errors identify the missing grant. The operator grants it explicitly; no repeated prompt loop occurs. CLI grants are not treated as Desktop grants, and missing Screen Recording does not disable otherwise supported AX actions.                                     |
| D02 | Ask a live model to edit a disposable TextEdit document containing English, Chinese, punctuation, and newlines, scroll a long document, and save through the native menu/dialog. | Independent file-byte comparison and a fresh UI observation match the requested result. Record encoding/newline normalization. No unrelated document changes and no shell completion of the task.                                                                                       |
| D03 | Ask a live model to complete a deterministic calculation in another app, with more than one test window open.                                                                    | The expected result appears in the intended window and is checked independently. Ambiguous selection requires a new observation; a successful tool return alone does not prove delivery.                                                                                                |
| D04 | Change or close the target after observation; also present instruction-like text requesting a denied tool such as arbitrary launch.                                              | Stale/ambiguous refs cause re-observation or a clear failure, with no guessed action on another window. Denied tools remain blocked and the task does not bypass them through shell. This does not prove app isolation or resistance to every prompt injection through an allowed tool. |
| D05 | Press Stop during a slow real observation and during a sequence of real edits; separately terminate the MCP process and recover.                                                 | Record stop receipt, process settlement, and the final UI state. No new action occurs after cleanup settles; an already delivered edit is not described as rolled back. Recovery begins with a fresh observation and no automatic repeat of the edit.                                   |
| D06 | Ask a live vision-capable model to identify a randomized marker visible only in screenshot pixels.                                                                               | The answer matches independent ground truth. The marker is absent from prompt text, AX content, tool metadata, and filenames. The screenshot reaches the next provider turn as an image.                                                                                                |

Run all cases on clean fixture state and retain failures as well as successes. Do not impose a blanket three-run rule: repeat when investigating variability or validating a fix, recording each attempt and its cause. These bounded workflows establish support for the tested apps, versions, model, and entrypoints, not universal desktop compatibility.

Record observation/action/task duration, provider-turn count, screenshot size, and cancellation settlement time. Compare execution with the actual configured host/upstream deadlines. Report measured latency; there is no new 20-second operation or five-second cleanup promise. A hanging request, surviving actionable descendant, denied dispatch that still runs, or replayed mutation is a release failure regardless of nominal latency.

Do not test two simultaneous workflows and declare them isolated: the design explicitly cannot guarantee that. The shipped instructions must explain sequential operation across all Apexo instances, fresh observations after interference, and that other non-desktop tasks may continue. Enforced concurrency or app confinement requires a new design and new acceptance.

## Implementation and repository gates

Keep launcher/packaging tests with the plugin. Reuse `packages/apexo/test/v2/mcp-native.test.ts` and the existing plugin runtime suites for host behavior; add one focused installed-bundle integration fixture if needed. Keep graphical acceptance as an explicit harness/manual procedure against selected artifacts. Do not add production Core imports or a new native fixture framework to support this documentation plan.

Run focused tests from their package directories and use `bun typecheck`, not direct `tsc`. Before pushing changes, run the repository-required checks sequentially because generation can modify files read by later checks.

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

No public schema change was needed. The implementation's generic host fixes are documented in the acceptance record. If another independently justified host fix changes public Protocol or Server HttpApi, regenerate with `bun run generate` in `packages/client`; use `./packages/sdk/js/script/build.ts` from the root when the legacy SDK surface needs regeneration. Finish writers before readers and never edit generated sources directly. Make changes on a branch with a PR to `main`; required test/typecheck CI must pass before merge.

## Acceptance record and release decision

Start every case as `not run`. Use `pass`, `fail`, or `blocked` only with evidence, including the artifact and entrypoint to which it applies. Document any bug fix under the relevant English `docs/testing/` record with root cause or explicit unknown, reproduction, fix, and verification. A passing rerun alone does not prove a fix.

The dated [implementation acceptance record](development/computer-use-acceptance.md) contains the current per-case results, artifact identities, observations, measurements, and bug links. Keep those results in that record rather than maintaining a second status table here.

Keep private screenshots, text, and traces out of public logs and Git. Reports should contain sanitized outcomes, hashes, and durable evidence references rather than ephemeral log paths.

- [ ] B01–B04, I01–I08, and D01–D06 pass for the advertised artifacts and entrypoints; unrun desktop cases block a support claim.
- [ ] The copied permission profile is verified against effective rules, and README accurately explains tool-level approval, broad upstream arguments, process-argument text exposure, and sequential-use limits.
- [ ] Packaged launch, real UI actions, image/model consumption, Stop/cleanup, no-replay recovery, and data cleanup have direct evidence.
- [ ] Local repository gates and required PR CI pass; feature acceptance remains separate from generic CI success.

The plugin implementation and executed tests do not by themselves certify every case above. Consult the dated result matrix before making a platform or workflow support claim.
