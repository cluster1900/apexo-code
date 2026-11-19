# Computer Use acceptance fixtures

## BUG-20261116-002: Fixture used unsupported catalog and Client shapes

- Scope: initial Computer Use integration harness; no host production defect.
- Observed: a catalog with an absolute plugin entry failed with `Plugin path must be relative`; subsequent attempts called `.find` on the skills envelope and selected an assistant tool's nonexistent `tool` field.
- Expected: construct a valid catalog and assert actual returned data.
- Reproduction: use an absolute `plugins[].source` catalog entry, treat `skills.list()` as an array, or select `AssistantTool.tool` in the initial harness.
- Root cause: the fixture did not follow the existing catalog and generated Client/message contracts.
- Fix: stage a regular-file bundle under a relative catalog entry; use `skills.list().data`, `messages.list(..., order: "asc")`, and `AssistantTool.name`. Close the owned backend when fixture setup fails.
- Verification: native CLI and rebuilt Electron-backend integration each passed seven checks, including Promise, Effect, and SDK clients, real plugin tools, and manual approval accept/reject. Failed attempts remain separate from these results.

The later restricted-child fixture initially repeated a generated Client shape mistake (`sessions.listTasks` and an extra `.data`). Its actual API is `client["server.task"].list(...)`, which returns the array directly. After correction, a positive independent-agent control and a real inherited-denial child Task passed. This is another fixture contract error under this record, not a new production failure.

## BUG-20261116-003: Controlled provider inherited xAI's real model endpoint

- Scope: local recording-provider fixture.
- Observed: a controlled test sent its synthetic API key to xAI and received HTTP 400 `Incorrect API key provided`.
- Expected: controlled tests call only the local fixture provider; live xAI tests use the existing sign-in.
- Root cause: a provider-level override did not replace the already registered xAI model's API; the built-in xAI language hook also applies xAI-specific behavior.
- Fix: use a separate `computer-fixture/model` provider/model for controlled tests and a separate explicit live-xAI mode. Do not weaken production provider configuration or authentication.
- Verification: controlled integration completes against the recording provider; live xAI separately completed Skill loading and real native version/permissions tools with the user's existing Grok sign-in.

## BUG-20261116-004: Source TUI fixture omitted the OpenTUI TSX preload

- Scope: full native TUI acceptance process launched in a disposable workspace.
- Observed: startup rendered `Cannot find package 'react'` from the TUI clipboard context. An overly broad readiness expression treated the error screen as ready, and the submission check timed out.
- Expected: launch the actual source TUI with the repository's OpenTUI transform and submit only after a real prompt is ready.
- Root cause: the child working directory did not inherit the package Bun preload configuration.
- Fix: explicitly pass the existing `@opentui/solid/preload` to the owned child and reject error screens in readiness checks.
- Verification: mini and fullscreen native TUI each passed startup/session attachment, real prompt/tool/history execution, and rendered completion checks. Three checks passed per entrypoint.

## BUG-20261116-005: Live TextEdit scenario did not settle after editing

- Scope: live `xai/grok-4.7` desktop workflow against upstream 1.3.1 on macOS arm64.
- Observed: the first attempt saved the requested Unicode/newline content, but repeated menu verification encountered `WINDOW_NOT_FOUND`, absent menu surfaces, and incomplete menu traversal timeouts. The harness's 240-second wait expired. This is a failed complete scenario even though independent file bytes changed correctly.
- Expected: finish after a fresh observation verifies the requested edit/save, or report a bounded failure without replaying the mutation.
- Root cause: not fully established. Repeated broad menu searches and the first harness's reused document title made recovery harder. A second attempt used the same title while the first fixture window remained open; it is retained as a separate attempt, not proof of a fix.
- Changes under evaluation: use unique fixture document titles, a lower reasoning effort, a bounded provider-turn allowance, and explicit autosave/disabled-Save guidance. Preserve exact saved-file checks.
- Verification: the unique-title live TextEdit rerun passed after the separate no-tools Responses fix; independent saved-file bytes matched English, Chinese, punctuation, and the final newline. This verifies the revised bounded workflow, but does not establish the cause of the earlier broad-menu timeouts or universal menu compatibility.

## BUG-20261116-008: UI harness selected the wrong server contract and raced actions

- Scope: browser/packaged Desktop test setup and assertions.
- Observed: initial browser attempts either loaded V2 permission fields through the V1 loader, selected an unregistered server key, or expected native plugin controls from a mixed backend that advertises V1 first. Packaged runs also attempted Install while Download was still pending and treated generated Client `sessions.active()` as an envelope.
- Expected: test the declared native runtime with a supported config dialect, the actual registered server identity, enabled UI controls, and the generated Client's actual return types.
- Root cause: stale fixture assumptions about runtime selection, server routes, readiness, and Client envelopes. No product permission/parser weakening is justified by these setup failures.
- Fix: run the browser against the pure native server; build/package Desktop with its existing V2 sidecar; use the frontend's registered proxy/`sidecar` server identity; wait for the exact enabled control; read the active-Session map directly. Test startup explicitly waits for the Plugins tab. Stop is checked by active ownership settlement rather than a successful wait receipt from an interrupted run.
- Verification: browser UI passed three installation/submission checks. The packaged Desktop then passed five checks including the same real bundle workflow and Stop. Mini/fullscreen TUI passed separately. Failed attempts and the original final-wait error are retained; these passing scenarios do not establish support for the default V1 Session runtime.

## BUG-20261116-009: Cancellation fixture assumed a healthy pre-cancellation connection

- Scope: native plugin lifecycle harness after real upstream cancellation.
- Observed: a cancellation test initially failed to detect the actual wait child because flags appeared between `wait` and `60000`. After correcting that predicate, a later reload assertion incorrectly expected a working connection that cancellation had retired.
- Expected: observe the actual native child, verify it exits after interruption, and explicitly reconnect before testing healthy-generation retention.
- Root cause: fixture command-shape and lifecycle assumptions, not an established cancellation defect.
- Fix: select the exact installed executable with both wait tokens regardless of intervening flags. Join its PID after interruption, then use existing MCP Retry before subsequent lifecycle cases.
- Verification: the CLI native harness passed eight checks; the real wait descendant settled 15 ms after interruption in that run, and subsequent retry/update/uninstall checks passed. This is a measurement, not a cleanup-time guarantee.

The 0.1.1 catalog release exposed another executable-path assumption in the same harness. With `COMPUTER_USE_BUNDLE` set to the dual-architecture bundle, the wait call started and the fixture timed out while looking for `bin/agent-desktop`. The launcher had selected `bin/arm64/agent-desktop` on the test Mac. The native harness and UI setup scripts now resolve the actual executable from both bundle layouts and canonicalize the path used to observe the wait child. Rerun `bun script/computer-use-native.mjs cli` from `packages/apexo` once for each layout. The dual-architecture and standalone arm64 runs each passed all nine checks, including observed wait-child cleanup.

## BUG-20261116-011: Ref fixture assumed unsupported schema and stronger delivery guarantees

- Scope: direct-MCP packaging/ref acceptance fixture, not Apexo's permission boundary.
- Observed: the first attempt assumed `list-windows.data.windows` instead of the documented array; the next passed unsupported `title` arguments instead of selecting a discovered `window_id`. Later attempts acted on a window-container ref and assumed every closed-window failure must be `STALE_REF` with `not_delivered`. One screenshot attempt also failed and was retained as failed evidence.
- Expected: select the exact discovered window and a live editable ref; preserve the upstream delivery disposition when the window disappears.
- Root cause: fixture schema assumptions and an unsupported pre-dispatch guarantee. A confirmed editable ref after its window closes can return `ACTION_FAILED`, `post_action_verification`, `delivered_unverified`, `retry: unsafe`. The file remained unchanged; this does not prove the action was never sent.
- Fix: use discovered window IDs and an editable ref verified by a real value read before closure. Check the actual error disposition and unchanged fixture bytes, never repeat the mutation, and describe uncertain delivery honestly. Inline screenshots and old-namespace rejection remain independently asserted.
- Verification: the final direct-MCP run passed three checks: minimal PATH/private state/inline image, new namespace rejecting old refs, and a closed-target failure or uncertain delivery with no file change. This is upstream/plugin boundary evidence, not proof of app confinement through Apexo.

The single intervening screenshot failure's cause remains unknown; subsequent successful captures do not establish its repair. Final browser, packaged Desktop, and direct-MCP captures passed independently.

## BUG-20261116-012: Controlled UI provider retained an unused post-rejection step

- Scope: manual permission UI test sequence.
- Observed: the reject interaction completed, but the following accept case never produced a pending permission. The next prompt consumed a scripted final text response left behind by the rejected drain.
- Expected: each case starts with the intended tool call; a denied drain may stop without requesting a follow-up provider turn.
- Root cause: the fixture queued both a tool and a final response for every case. Rejection interrupted execution before the final response was consumed.
- Fix: queue only the tool and use the fixture's default completion. Use a fresh confirmation Session after the separate Stop scenario and assert results from newly created message IDs.
- Verification: the browser UI passed five checks including actual manual permission rejection and acceptance against the installed plugin. The original timeout attempts remain recorded.

## BUG-20261116-013: Calculator fixture exhausted its artificial provider-turn allowance

- Scope: live xAI Calculator scenario.
- Observed: with a 24-turn fixture allowance, the model entered `137 × 29` and located Equals but stopped before clicking it or verifying the result. The model explicitly reported the incomplete task; the independent completed-observation assertion failed.
- Expected: complete and observe the calculation without weakening final-state assertions.
- Root cause: the fixture's provider-turn allowance was too small for the observed workflow's repeated fresh observations. This was not an incorrect successful calculation claim.
- Fix: use a 40-turn allowance for live acceptance only, retaining the existing wait deadline and final observation assertion.
- Verification: the rerun completed and a real tool observation contained `3973`; the live-model calculation case passed. The first attempt remains a failed scenario, not a passing sample.

The final harness randomizes both operands. A further live run on the final assembled bundle entered `137 × 52` and independently found `7124` in completed tool output. It passed without changing the production profile or the result assertion.

## BUG-20261119-021 — Calculator started with a restored expression

- Scope covers Calculator 12.0 on macOS arm64 with Computer Use 0.1.1 and Agent Desktop 1.3.1.
- To reproduce, launch a separate Calculator process with a restored display of `1÷(1+2.70.3)`, identify its window by the new process ID, then click `7`, `Multiply`, `9`, and `Equals` without clearing. The display returned `26.84130471` because the new keys continued the restored expression. The expected result of a fresh `7 × 9` is `63`.
- A separately launched Calculator can restore its previous expression. The test assumed a zero starting display.
- On the owned Calculator window, take a new snapshot after each distinct Clear action and wait for the display to show `0`. Take a fresh snapshot before choosing each key and read the display after each action. The observed sequence was `7`, `7×`, `7×9`, then `63`. The original Calculator process was left running.

## BUG-20261116-014: New-document Save dialog did not complete

- Scope: exploratory live xAI TextEdit new-document Save dialog, upstream 1.3.1 on macOS arm64. Existing-file edit/save and scrolling passed separately.
- Observed: the first attempt created a document without activating TextEdit and could not find a visible target. A second attempt explicitly activated TextEdit and waited for the exact visible/accessibility window, but did not save the file within the 40-turn allowance. A third attempt additionally permitted `desktop_focus_window` for this test only: the model edited the document, converted it to plain text, and opened the native Save sheet, but did not navigate to the destination or save. The independent file-byte assertion failed because the destination did not exist.
- Expected: save the new document through the native dialog and independently match its UTF-8 bytes, including Chinese punctuation and the final newline.
- Original reproduction: the historical `computer-use-live.mjs cli save-dialog` scenario used the existing xAI sign-in and granted `desktop_focus_window` for that trial.
- Root cause: unresolved. The final transcript contains incomplete locator traversal, `actionability_timeout` with `visible: unknown / live offscreen state unavailable` for some Save-sheet targets, and a type action rejected because semantic action was unavailable and focus fallback was denied. Other sheet controls worked. These observations do not establish whether a different workflow, upstream change, or broader tool profile would reliably complete the task.
- Changes evaluated: exact visible-window readiness, explicit target focus, and native menu/sheet observations. The focus exception remains test-only; the distributed 17-tool profile was not broadened to turn this failed experiment into an accepted workflow.
- Original verification: that attempt consumed 40 provider turns in 134.251 seconds. No file was saved at the requested destination, and the model explicitly reported the unfinished save. Fixture-owned unsaved documents were discarded after the run.

The November 19 follow-up created a fresh Rich Text document and used MCP to choose File > Save. The sheet showed `Save As` and a default iCloud location. An exact `Where` ref returned `actionability_timeout` with `visible: unknown` and `live offscreen state unavailable`. The receipt said `not_delivered`. An app-targeted shortcut produced an unverified receipt and left the sheet unchanged. A separate plain-text conversion attempt left the app-level confirmation visible when the exact document's sheet lookup returned `ELEMENT_NOT_FOUND`.

A foreground control sent Cmd+Shift+G, typed the owned local folder, and confirmed it with Return. A sheet snapshot with `max_depth: 2` verified the exact destination and exposed the Save controls that the deeper file listing had displaced. MCP then cleared and typed the filename and clicked Save. `textutil -convert txt -stdout` independently recovered the exact English and Chinese text, punctuation, and final newline from the RTF file. This established that the native Save action could write the new document after a confirmed destination. The foreground keyboard steps were test-only.

### Resolution in Computer Use 0.1.2

The exact-window and app-level `Where` refs both reproduced `actionability_timeout` with `visible: unknown` and `not_delivered`. The same failure occurred with the sheet collapsed. The control remains the location readout. The installed Skill now uses the expanded sheet's sidebar and fresh, bounded snapshots of the visible directory column to navigate. It verifies `Where` after each change, uses the settable Save As value for the exact name, and observes the saved window. Clearing the collapsed filename and then trying `desktop_type` reproduced an independent `POLICY_DENIED` because the field lacked semantic insertion. `desktop_set_value` succeeded on the same field with the existing profile.

Run `bun script/computer-use-save.mjs cli` or `bun script/computer-use-save.mjs desktop` from `packages/apexo` with `COMPUTER_USE_BUNDLE` pointing at the assembled bundle. A recording provider drives the real installed Skill/MCP through an Apexo Session. The fixture loads the bundle's exact `permissions.json`, enters manual review, and checks the action ID before every one-time reply. `desktop_press` and `desktop_focus_window` stay outside the model's tool catalog. Only the approved Save dialog actions change the destination or write the file. The fixture verifies the confirmed nested folder, filename, original TextEdit window identity, and the English and Chinese text, punctuation, and final newline independently recovered from the new RTF. Coverage is the tested macOS TextEdit sidebar and column layout.

The separate live-model follow-ups selected Downloads. One reached the nested directory, set the filename, and received an unverified Save click before the Session wait failed at the transport boundary. Another lost its exact window during the directory observation and returned `WINDOW_NOT_FOUND`. Neither live run independently verified a saved file. These attempts remain separate from the successful controlled regression.

## BUG-20261119-016 — The packaged Desktop UI runner did not select the renderer

- Scope covers the packaged macOS Desktop UI acceptance runner. Run `bun script/computer-use-ui.mjs desktop` with the rebuilt app and the catalog bundle. The browser-level CDP connection attempted `Target.createTarget` and received `Not supported` before it could interact with the existing window.
- Attach to the existing `apexo://renderer/` page through its debugger URL. Wait for the inline image, scroll the lazy attachment into view, and confirm its intrinsic size. The runner now exercises Stop during an actual MCP wait and joins its child process. Use explicit MCP Retry before the following manual approval case because an interrupted native tool can retire the transport.
- One rerun selected an inaccessible-to-capture Calculator window, although the window enumeration marked it accessible. The tool returned `could not create image from window`. The fixture now opens its own uniquely named TextEdit document, selects its visible window ID, and observes the screenshot tool's terminal result before asserting provider media or renderer state.
- Verification with 0.1.1 passed seven checks in the rebuilt Desktop and six in Web. The process disappearance and idle Session status followed the Stop click within 96 ms on Desktop and 85 ms on Web. Both runtimes recovered and exercised manual reject and accept. A separate packaged start returned `Failed to start server` while the typecheck was running. The isolated relaunch passed. That startup failure's cause remains undetermined.

## BUG-20261119-024 — The Desktop runner clicked Reload before it was enabled

- Scope is the native Desktop and Web Computer Use acceptance runner. During a packaged Desktop run with 0.1.2, the backend reported the plugin enabled while the renderer's runtime Reload button was still disabled. The test click returned an actionability error before the plugin was applied.
- The renderer separately tracks pending operations and runtime refresh. The test had waited for backend installation and then clicked Reload without checking its enabled state.
- The runner now waits for the exact enabled Reload button and still checks the resulting runtime and MCP status. `bun script/computer-use-ui.mjs desktop` and `bun script/computer-use-ui.mjs browser` passed seven and six checks respectively with the 0.1.2 candidate.

## BUG-20261119-025 — The Save fixture created a folder under the redirected Electron home

- Scope is the macOS Save regression setup. Export `CFFIXED_USER_HOME` for a disposable packaged Electron profile, then run both Save regression entrypoints from the same shell. The sheet showed the real TextEdit user's Downloads, and its file list lacked the exact fixture folder. The harness timed out before saving.
- The system `osascript` path lookup inherited the Electron-only Foundation home override. It created the new fixture directory under that override while the already running TextEdit used the actual user's home. Running the same Downloads lookup with and without the override returned two distinct directories.
- The fixture's system AppleScript operations now omit the Electron-only setting. The test creates its directory under the actual GUI user's Downloads and still requires fresh UI evidence of the exact destination before saving.
- With the redirect still exported and `COMPUTER_USE_BUNDLE` pointing at the fetched 0.1.2 catalog artifact, the CLI and Electron backend regressions passed. The exact `ask` profile generated 20 and 23 one-time approvals respectively. Both files were read back successfully.

## BUG-20261119-018 — The timeout fixture could stop before recording its PID

- The compatibility stdio timeout test expected a launched MCP child to record its PID before it was terminated. A 100 ms startup bound included the fixture's SDK import time and could terminate the child before it wrote the PID. The PID file was absent during the failing parallel run.
- Reproduce with the old `local stdio timeout terminates the real server process` test during a busy aggregate run. The new command records its PID before waiting, without importing the MCP SDK. The fixture allows 500 ms and requires a positive integer PID before checking exit.
- From `packages/apexo`, run `bun test test/mcp test/server/httpapi-mcp.test.ts test/v2/mcp-native.test.ts test/v2/mcp-preferences-native.test.ts --timeout 30000`. The final focused run passed 106 tests, including the real timeout and inherited-pipe crash regressions.
