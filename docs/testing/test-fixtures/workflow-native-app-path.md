# BUG-20261014-122: Native Workflow fixture used its wrapper as the app root

- Scope: isolated native Desktop Workflow UI fixture; one initial source-validation timeout plus one deliberate original-path reproduction.
- Observed: saved-source discovery worked, but validation displayed the generic operation error; bundled-backend browser validation passed on the same build.
- Expected: native development launch resolves the staged Workflow interpreter from the Desktop project's resources directory.
- Reproduction: launch Electron through an external fixture wrapper without setting the application root, then validate a saved Rhai workflow.
- Root cause: Desktop development startup resolves the interpreter relative to `app.getAppPath()`. The fixture's wrapper resides outside the Desktop project and did not set that application path. The deliberate original-path probe returned `InvalidRequestError` with `Apexo workflow script interpreter is not installed`, confirming the lookup failure.
- Fix: set the fixture application's root to the real Desktop project before importing its main entrypoint; log initial and corrected application paths for verification. No production source changed.
- Verification: the corrected native window passed all eleven checks. Logs show the initial root was the external wrapper directory and the corrected root was the Desktop project. The `--probe-original` fixture flag preserves the original-path reproduction; it intentionally fails validation and is not an acceptance command.
