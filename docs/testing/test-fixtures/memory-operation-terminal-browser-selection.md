# BUG-20261015-299: Operations fixture expected a note body before selecting it

- Scope: Native Memory operations fullscreen narrow-screen acceptance.
- Observed: The real 80×24 Memory browser displayed its enabled operations shortcut, enabled Memory status and catalog. The fixture timed out waiting for the extraction statement, while the detail pane showed the index note rather than the observation body.
- Expected: Enter operations after its actual enabled browse control is visible, then verify the durable capture receipt in the operations view. A browse catalog does not guarantee a particular note body is selected.
- Root cause: The fixture coupled operation readiness to incidental note selection and body visibility. Its 120×40 mini run happened to render the marker.
- Fix: Require the operations shortcut and settled enabled status, preserving the subsequent actual capture-row and provider-count assertions. No production rendering or capture assertion was weakened.
- Reproduction: Open Memory on a real 80×24 fullscreen native attach after automatic capture.
- A subsequent 80×24 run reached discard review but its unavailable reason was below the detail viewport. The fixture now scrolls the actual detail region after observing the settled preview, and likewise scrolls the clear confirmation into view. This is the same viewport-visibility assumption, not an independent recurrence.
- Verification: Real mini/fullscreen at 80×24 and 120×40 passed all nine checks with three provider calls per run. Narrow screenshots/text preserve the wrapped warning, enabled operations controls and scrollable unavailable/committed detail.

After scroll ownership was repaired separately in BUG320, the actual confirmation was fully visible but wrapped “cannot be” and “undone” across terminal lines. The assertion now matches only intervening whitespace and the mini frame gutter, preserving the whole irreversible-warning phrase instead of requiring an unwrapped line.
