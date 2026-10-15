# BUG-20261015-162: Explicit transport flag used the wrong typed argument key

- **Scope:** Off-tree terminal protocol-selection authoring; one episode.
- **Observed:** Apexo package typechecking reported TS2551 for `args.sessionProtocol` at two `RunCommand` accesses. The `effectCmd` inferred argument contract exposes `"session-protocol"`.
- **Expected:** Read the canonical typed option without casting or relaxing the command type.
- **Cause:** The new handler assumed the camel-case key available in other yargs-facing command code also appeared in the Effect handler's declared contract.
- **Fix:** Use `args["session-protocol"]` consistently at CLI boundaries. Internal `MiniCommandInput.sessionProtocol` remains a separately declared field and is explicitly mapped into the handler option.
- **Verification:** `bun typecheck` in `packages/tui` and `packages/apexo` passed after correction. Real mixed-server mini/fullscreen explicit native attachment completed ordinary prompt and Question approval; command-error acceptance rejected unsupported choice, native headless, and non-auto local execution with zero new Sessions and zero provider calls. Final scoped results are recorded in the feature document.
