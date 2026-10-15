# BUG-20261015-372: Source-only publication probe was invoked against Desktop

- Scope: automatic Dream acceptance invocation and its source preload observer.
- Observed: the Desktop publication-fence probe timed out waiting for an observer that was never installed. Ordinary and failed-source Desktop checks passed.
- Expected: source instrumentation modes reject unsupported packaged runtimes before starting any fixture processes.
- Reproduction: invoke `bun script/grok-memory-automatic-dream-native.mjs desktop --publication-fence` from `packages/apexo`.
- Root cause: the observer is a Bun source-module preload. The compiled Desktop backend does not load that source module, and the Desktop fixture does not apply Bun preload arguments.
- Fix: reject the unsupported combination immediately. Keep the real publication-order proof in the source CLI gate; verify packaged behavior through the supported Desktop modes. This does not claim a Desktop publication race was found or fixed.
- Verification: the corrected invocation exits immediately (0.489 seconds), before fixture startup, with the explicit source-preload requirement. The source CLI publication-fence proof already passes two checks / two calls; shared rebuilt Desktop ordinary and failed-source probes pass five / three checks respectively.
- Independent occurrences: one invocation episode; no recurring constraint is promoted.
