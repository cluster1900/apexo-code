# Native Memory unsupported slash commands

- **Bug ID:** BUG-20261015-173.
- **Scope:** Draft native Memory App and terminal command presentation.
- **Observed:** Actual production-browser and mini-terminal acceptance reached the unsupported `/flush` command after successful passive management. The slash menu had no selectable matching entry, so Enter remained in the empty menu instead of reaching the submit interceptor or showing the promised guidance.
- **Expected:** Unsupported native Memory operations remain discoverable and are consumed locally with truthful capability guidance, without calling compatibility management or the model.
- **Root cause:** The native adapter removed or disabled the command entries while relying on a later submission interceptor. The open autocomplete menu handled Enter first. This is a UI defect in the draft, not a backend operation failure.
- **Fix:** Retain native remember/flush/dream entries with fixed unsupported descriptions. Selecting one shows local guidance (or the passive browser's capability explanation in mini). Exact-token direct submission remains intercepted before model selection or Session creation. Compatibility entries retain their existing actions.
- **Verification:** Actual mini and fullscreen each passed six checks, with five fixture setup provider calls and zero additional provider calls. No compatibility Memory request was made. The final browser/native-window results are recorded in the feature acceptance report. No upstream-runtime result is counted as Apexo verification.
