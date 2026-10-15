# BUG-20261014-010: Goal Verification Evidence Leaked Unfiltered Session Summary Diffs

- **Status**: Fixed & Verified; **Verified Occurrences**: 1; **Linked Rule**: None (below threshold).
- **Scope**: Message evidence passed from the Goal loop to independent planner and verifier sub-sessions.
- **Observed**: Although Git patches and changed-file manifests filtered `read: deny/ask` paths, the serialized session message objects still included `user.info.summary.diffs`, leaking host-generated diffs of restricted files.
- **Expected**: Automatically generated workspace diffs must respect the verifier's read permissions while preserving raw user inputs and actual tool receipts.
- **Reproduction**: Run `bun script/grok-goal-changes.mjs cli|desktop` with `read: deny/ask` on `secret.env` while the worker overwrites that file.
- **Root Cause**: Host UI message summaries (`info.summary`) were serialized alongside conversation messages into verifier evidence.
- **Fix**: Strip user message summaries and automatic patch/step-snapshot metadata when constructing planner/verifier evidence; rely on permission-filtered Goal Git evidence for workspace diffs.
- **Verification**: Added assertions verifying that neither the verifier request payload nor tool receipts contain restricted file contents; CLI and Electron suites passed 7/7 scenarios (109 requests) each.
