# BUG-20261015-135: Preserved Desktop benchmark bundle lacked external module resolution

- **Scope:** The isolated fixed-backend UI performance harness; no production change.
- **Observed:** Importing the preserved Desktop backend from an artifact directory failed before a measurement with ERR_MODULE_NOT_FOUND for the external native PTY package. No benchmark sample was produced.
- **Expected:** A preserved backend must resolve the same external runtime dependencies as its original Desktop artifact.
- **Root cause:** Relocating the bundled main/chunks tree changed Node's package lookup ancestry. The retained bundle externalizes native packages; moving only generated JavaScript did not retain their resolution path.
- **Fix:** Link the preserved main directory's node_modules to the existing Desktop dependency tree used to build the artifact. Keep the bundle bytes unchanged and continue serving the separately selected App artifact. This fixture change adds no product dependency or alternate Session runner.
- **Reproduction:** Start the fixed-backend benchmark from a relocated artifact containing main/chunks but no reachable Desktop dependency tree.
- **Verification:** Both corrected ten-sample Plan/media benchmark runs exited zero and reaped owned processes; all 1,810 preserved baseline artifact files retain their original SHA-256 hashes. All 20 browser diagnostics contain no Long Task entries. The failed launch is excluded from benchmark samples.
- **Occurrences:** One fixture construction episode; not evidence of a product startup failure or a performance regression.
