# BUG-20261015-082: Native Task details exceed the narrow fullscreen dialog

- Status: integrated correction verified in live narrow fullscreen PTY.
- Scope: fullscreen terminal Task dialog at 80×24.
- Independent occurrences: one visually confirmed native Task episode.

The initial PTY text assertions passed because the title, cancellation control, and restart guidance were present. Inspection of the current screen showed that a long native child ID wrapped to two rows and the unconstrained combined list/detail dialog pushed the last output row below the terminal boundary. Text presence alone did not establish usable bounds.

The Task dialog now bounds its height by the space remaining below the shared modal's top offset. The child ID occupies one nonwrapping row; the list can scroll while the selected output keeps its bounded viewport. The stable outer box remains mounted. No shared dialog implementation or provider behavior changes.

The fixture now inspects the actual renderer geometry for the Task root, title, and output viewport in conflict, interrupted, and long-output states, and saves the current terminal buffer before cleanup. Native panel PTYs passed at 80×24 and 120×40, each 3 checks and 8 provider calls, including bounds and current-screen inspection. Actual compatibility fullscreen `/tasks` also passed both sizes. Commands from `packages/apexo`: `bun script/grok-native-task-tui.mjs --fullscreen --narrow`, the same command without `--narrow`, and `bun script/grok-tasks-tui.mjs --fullscreen` with and without `--narrow`. Visually similar Workflow and OAuth defects are not counted as repetitions of this Task-specific cause.


Shared verification: App and terminal adapters each passed six tests / 32 assertions, all 21 typecheck tasks passed, and both live native mini/fullscreen narrow PTYs passed three checks / eight provider calls. Production browser and actual rebuilt Desktop window each passed six checks / eight calls. These reruns add no independent bug occurrence.
