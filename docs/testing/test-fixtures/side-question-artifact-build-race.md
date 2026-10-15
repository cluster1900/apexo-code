# BUG-20261014-089: Browser fixture read a Desktop artifact during rebuild

- Scope: side-question production browser acceptance fixture; one observed setup failure.
- Observed: the bundled-backend launcher failed with ENOENT while scanning `packages/desktop/out/main/chunks` before any UI checks ran.
- Expected: acceptance uses a complete, stable build artifact.
- Reproduction: launch the browser fixture in Desktop-backend mode while the shared Desktop build has cleaned its output directory.
- Root cause: App build completion was mistaken for readiness of the separate Desktop backend artifact.
- Fix: use the source CLI backend for browser verification during a Desktop rebuild; wait for the Desktop build's successful exit before bundled-backend or native-window verification.
- Verification: production App with source CLI backend passed nine browser checks; after the explicit final artifact-ready signal, bundled browser and native Desktop each passed nine checks. This is a fixture coordination failure, not an observed product failure.
