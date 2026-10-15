# BUG-20261015-322: Memory operation fixture dropped the mixed-backend selection

- Scope: Shared Memory operation terminal acceptance with `--desktop` or `--mixed`.
- Observed: Integration review found that the terminal script passed `mixed: true`, but `startMemoryOperationUiFixture` forwarded only `runtime` to `startPlanUiFixture`. That helper's default crashes the initial backend and starts a source native server. A run with `--desktop` would therefore exercise source execution after starting Desktop.
- Expected: Explicit packaged/mixed acceptance retains the selected backend and proxies its native routes; default source/browser acceptance keeps its existing native-server setup.
- Reproduction: Trace `--desktop` through both fixture constructors and the `if (!options.mixed) await runtime.crash()` branch. No prior four-way source-terminal result is reclassified as packaged acceptance.
- Root cause: A wrapper omitted an existing fixture ownership option.
- Fix: Forward `mixed` unchanged to the underlying fixture. The same review narrowed capture/Dream classification to provider system/developer instructions, excluding historical user/tool content; no observed classification failure or extra recurrence is claimed.
- Verification: Actual fixture formatting and `node --check` pass. Shared source mini/fullscreen at both sizes and rebuilt mixed Desktop mini/fullscreen at 80×24 each pass nine checks / three provider calls after this correction. The preserved Desktop backend is selected through the actual proxy path. This is one authoring defect; it does not establish a product backend-selection defect.
