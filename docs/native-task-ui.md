# Native Task management surfaces

The existing App Task button and dialog, fullscreen `/tasks` dialog, and mini `/tasks` panel now have integrated protocol-aware native routing. The production browser and actual rebuilt Desktop window each passed six checks with eight provider calls across en/zh/zht; all six native screenshots were inspected.

The App uses its selected server's protocol. Terminal actions retain compatibility preference on mixed servers and fall back to native health only when compatibility health is missing. Native actions use list/output/cancel; they never admit a prompt, resume a child, or wake provider work. Cancellation is bodyless and joined. A starting-worker or stale-ownership conflict remains visible while the task stays running; passive polling does not erase this action feedback.

Native list requests are bounded to the newest 100 children. The foreground checkpoint described recent foreground tasks and a count within that returned list. The background extension below removes the foreground restriction while preserving that bounded count. It does not imply an unbounded total. Failed and interrupted remain separate states, and process-restart interruption directs the user to inspect output before starting a new task. There is no automatic retry.

Presentation normalization retains the actual child identifier and maps native description and timestamps onto existing row presentation. Scope changes abort outstanding requests and clear rows, selected output, and pending actions. Snapshot replacement removes obsolete optional fields. Selected-output polling ends when the App dialog closes.

## Scoped verification

- App and terminal HTTP adapter tests: each 6 tests and 32 assertions. They inspect emitted URLs, query encoding, bodyless cancellation, protocol preference, and sanitized 409/404/503/general cancellation failures.
- Private App, TUI, and Apexo package typechecks passed. Client and legacy SDK generation ran only inside the private validation workspace; generated outputs are excluded from the handoff.
- Production browser against the final isolated native server: 6 checks, 8 provider calls, English/Simplified Chinese/Traditional Chinese. It covers passive opening, list-scoped count, persistent cancellation feedback, joined stop, restart guidance, bounded multiline output, reopen without retry, and switching to an empty Session without stale rows/output. Screenshots were inspected.
- Actual compatibility mini/fullscreen CLI entry points passed at 80×24 and 120×40: count, `/tasks`, live shell output, stop, and refreshed cancellation state.
- Native terminal panels use the real `RunTasksBody` and `DialogTasks` components and native server through real PTYs. They cover passive opening, safe conflict, joined cancellation, interrupted guidance, and long completed output. This is panel/action acceptance, not a claim that the entire terminal boot sequence supports native-only servers. Each run makes 8 fixture provider calls; reads make none, and stopping the child permits one parent continuation.
- The paired composer measurement used identical packaged backend bytes: median 115→113.5 ms, p95 124→122 ms. See [measurement details](testing/performance/native-task-composer.md).

The native Task Core agent owns CLI/packaged-backend and installed-reference behavior comparisons. These UI checks do not independently establish installed reference behavior. The shared rebuild and native-window runs passed. Live App and terminal adapter reruns each passed six tests / 32 assertions; live mini/fullscreen narrow PTYs each passed three checks / eight provider calls. All 21 repository typecheck tasks passed after UI integration. Aggregate gates remain separate. Background Tasks, active child steering, and automatic interrupted replay are outside this foreground slice. Rendering a failed row is typed and supported, but the current real UI scenario does not deliberately produce a failed child; it exercises completed/cancelled/interrupted/running states.

New App copy is reviewed in [Task localization notes](native-task-ui-localization.md). Other locale fallbacks and English terminal copy are stated there rather than counted as fully localized.

## Background extension review

The background extension changes only the native summary adapter and the existing recent-task description. `background: true` is retained for row presentation, explicit false remains false, and an omitted flag defaults to false for older servers. Existing App and terminal adapter tests cover all three wire states. No composer entry, polling strategy or new surface is introduced.

The English description now says “Manage recent subagent tasks in this session (up to {{limit}}).” Simplified Chinese removes only 前台 from the reviewed phrase; Traditional Chinese removes only 前景. Existing terminology, sentence structure and the `{{limit}}` placeholder remain unchanged. This scope reuses the corpora documented in the localization review; it makes no new native-speaker certification or claim about other locales.

Background mode is not a promise of restart recovery. Interrupted guidance remains unchanged and no UI action automatically starts provider work. Shared generation/build and visual acceptance of this additive mode remain separate integration checks.

## Background Task extension accepted

Background rows preserve the native launch flag and show Background/后台/背景 in App. Mini/fullscreen retain their established English terminal scope. Shared browser/native-window checks each passed ten scenarios / 22 calls; live 80×24 terminal modes each passed seven / 22, with private coherent 120×40 runs also passing. Output/restart guidance screenshots now explicitly reveal the selected content and verify its visible bounds. The fixed-backend composer comparison is complete. See [background UI scope and evidence](native-task-background-ui.md); active child steering, transcript-fork/worktree delegation and Goal-owned background lifetime remain separate gaps.
