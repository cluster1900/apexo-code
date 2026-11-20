# Computer Use OS permission follow-up

Date: 2026-11-16. This extends the [implementation acceptance record](computer-use-acceptance.md) for D01. The user performed the grant actions in System Settings. No existing CLI/Desktop permission was reset and no TCC database was edited.

## Artifacts and isolation

The plugin is the same arm64 0.1.0 artifact recorded in the main report, backed by upstream 1.3.1. The model is the local recording provider, `computer-fixture/model`; it exercises the actual Session, permission, MCP, and image paths without sending desktop content to an external model.

The packaged Desktop was copied to an ignored test output directory, assigned the display name **Apexo Permission Test** and bundle/signing identifier `com.apexolab.desktop.computer-use-permissions.947f1657`, and ad-hoc signed. Its `app.asar` and compiled CLI payloads were byte-identical to the previously tested package:

| Payload      | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `app.asar`   | `505a96f01b4c249bdb193abc3883e5ec15fb166cd3461e6afe5f862eadf8ee2c` |
| Compiled CLI | `1381f03e776c71623ae3defc98076b01ddbd48e3b466283fef49c715e250ce04` |

It ran through Launch Services with the existing V2 sidecar and onboarding isolation. Its two dedicated permission entries were independently visible in System Settings. The copy was not a new production build or a claim about every signing/distribution identity.

A separate tiny AppKit launcher, **Apexo CLI Permission Test**, started the actual source CLI acceptance fixture and installed plugin. It pins the worker arguments and working directory in its bundle resources, so an OS relaunch does not start the ordinary product profile. The helper and all native outputs stay outside Git. Its code-signing identifier was `com.apexolab.computer-use.cli-permissions.8d2d131f2a0d42e5996b2d25fc46e476`; its launcher executable SHA-256 was `7df1c9c2a1a13d4bd7baba96fc9ebf9e458a3dc74214a8ac4485388b5bb9a434`.

The CLI helper's own name was not independently visible in the final System Settings lists, which also contained a generic `agent-desktop` entry. Its tool reports changed from denied to granted, but the precise OS grant attribution was not established. Do not treat a distinct bundle ID or a successful action as proof of independent TCC ownership.

## Observed stages

All document observations and screenshots below came through the real installed plugin. Documents contained only the synthetic marker `Apexo isolated permission fixture.`. Setup could open the fixture, but did not implement the measured observation or screenshot.

| Launch chain and state                                            | Independent observation                                                                                                                                            | Result                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Packaged Desktop, Accessibility denied / Screen Recording denied  | Passive status returned both denied. Snapshot and screenshot returned `PERM_DENIED`, `delivery: not_delivered`, `retry: safe`.                                     | pass                                               |
| Packaged Desktop, Accessibility granted / Screen Recording denied | Snapshot contained the exact fixture text. Screenshot returned `PERM_DENIED` specifically naming Screen Recording.                                                 | pass                                               |
| Packaged Desktop, both granted, first attempt                     | Status reported both granted and snapshot worked, but screenshot returned `INTERNAL`, `screencapture exited with error`, `could not create image from window`.     | failed attempt retained                            |
| Packaged Desktop, both granted, after controlled relaunch         | Fresh window observation, snapshot marker, and an inline PNG attachment all completed.                                                                             | pass for this run                                  |
| CLI helper, both denied                                           | Real snapshot and screenshot calls returned `PERM_DENIED` with no image.                                                                                           | pass for observed state                            |
| CLI helper, requested Accessibility-only stage                    | The host exited during manual setup and the controller timed out. On relaunch both permissions were granted, so the Accessibility-only assertion correctly failed. | not accepted                                       |
| CLI helper, both granted                                          | Snapshot contained the marker; screenshot returned a validated PNG of 267,147 bytes. Final revised-harness rerun returned a validated PNG of 262,908 bytes.        | pass for observed state; attribution limit remains |

The first post-grant Desktop screenshot failure has an unknown root cause. A successful controlled relaunch provides recovery evidence, not proof of a causal fix. Initial missing-app/stale-window attempts were discarded as fixture failures and were followed by fresh target selection; the original requests were not replayed as mutations.

The packaged Desktop's permission panel distinguished **Screen & System Audio Recording** from **System Audio Recording Only**. An enabled item in the latter did not make the plugin's Screen Recording check pass. The user then added the exact Desktop test bundle to the former and its switch was observed on.

## Cleanup and scope

Owned permission hosts, CLI daemons, and worker processes were stopped. The dedicated **Apexo Permission Test** entries were removed from both Accessibility and Screen Recording using System Settings, and their disappearance was observed. No separately named CLI-helper entry was visible to remove; generic/pre-existing entries were left untouched. The original launch environment continued to report both native grants as granted. The temporary app also registered the `apexo` URL scheme at startup; its previous handler, `com.apexolab.desktop.dev`, was restored.

**D01 remains partial overall.** The packaged Desktop's denied, Accessibility-only, and granted states now have direct evidence. The CLI helper's denied/granted outcomes are verified, but a separate CLI Accessibility-only stage and unambiguous grant attribution remain uncertified. The reverse combination (Screen Recording granted while Accessibility denied) was not separately tested. None of these results closes the independent new-document Save-dialog gap in D02.

## Follow-up repository verification

- Typecheck: 21 successful Turbo tasks, 20 cached.
- Full repository tests: six successful tasks, three cached; all 18 Apexo batches exited zero in 12m15.937s.
- Client and legacy SDK generated-source checks: passed without generated changes.
- HttpApi coverage/auth/effect: each passed 360 cases, zero failures/skips/missing.
- Plugin packaging: four tests / 68 assertions passed. The focused permission-profile and Responses tests passed three tests / 84 assertions on rerun; an earlier unnamed cleanup-hook timeout remains recorded under [BUG-20261116-017](../testing/test-stability/computer-use-repository-gates.md#bug-20261116-017-focused-follow-up-reported-an-unnamed-cleanup-timeout), without a claimed causal fix.
- Production source hashes, local links, script syntax, formatting, and Git whitespace checks passed. The plugin archive and production payloads were unchanged.

## Reproduce the CLI probe

From `packages/apexo`, with the assembled plugin at the usual path and Xcode Command Line Tools available:

```sh
bun script/computer-use-permissions.mjs
```

The command prints its new test app path and signing identifier. Run `denied` before granting anything; do not assume the identity is isolated unless the returned states are denied. Run `guide` only for explicit setup. Have the operator add the exact host identified by the permission guide and record what System Settings actually lists. After granting only Accessibility, run `ax-only`; after granting Screen Recording, run `granted`. The assertions require the exact state combination, the actual document marker, the expected permission error, or a decoded PNG signature as appropriate.

The controller writes private phase receipts atomically, preserves prior records on worker restart, and issues one explicit phase command at a time. It does not change OS grants, repeatedly request them, run an external model, or replay a prior phase after restart. If macOS quits the helper, reopen the printed test app, then reconnect the controller with:

```sh
bun script/computer-use-permissions.mjs --resume /absolute/printed-output-directory
```

Issue a new phase command after reconnecting. `finish` closes the owned fixture and host. Remove only the test identities' grants afterwards; never reset a user's existing application grants to obtain a missing-state test.
