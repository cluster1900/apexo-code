# BUG-20261014-069: Official failure-hook fixture selected a result error instead of a dispatch error

- Scope: Installed-official PostToolUseFailure comparison.
- Observed behavior: Reading a missing file produced an ACP failed tool update with a typed ReadFile.FileNotFound output, but did not fire PostToolUseFailure. PreCompact and PostCompact did fire successfully.
- Expected behavior: The comparison must exercise the official dispatch-error boundary that invokes PostToolUseFailure.
- Reproduction: Configure PostToolUseFailure and read a missing file in the pinned installed Grok runtime.
- Root cause: The fixture treated ACP failure presentation as equivalent to a tool dispatch error. A second candidate copied a source unit fixture that lacks the real todo store; the installed runtime successfully created that todo, so it also did not exercise a failure. The official read tool returns a typed result for a missing file; its failure hook routes on a distinct dispatch outcome.
- Fix: Use an invalid image_to_video duration of eight seconds. The official implementation rejects it before resolving media or making a media API call. Preserve the failed ACP event and PostToolUseFailure assertions.
- Verification: Direct isolated installed-runtime rerun passed, including failed ACP output and PostToolUseFailure plus both compaction observers. This record does not claim missing-file hooks were fixed in the official runtime.
- Occurrences: One fixture mismatch. No recurring constraint is promoted.
