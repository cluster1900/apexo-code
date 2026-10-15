# BUG-20261015-076: Native host creation failure escaped the Workflow error contract

- **Scope:** Off-tree native command sandbox integration; no released runtime failure.
- **Observed:** Server package typechecking rejected `workflows.launch` because its error union gained `CommandSandbox.Failure`, while the Workflow HTTP adapter accepts the Workflow domain failure, Session not-found and Goal errors.
- **Expected:** A failed immutable policy inheritance during native compatibility-host creation is represented by the existing typed Workflow failure contract.
- **Root cause:** `SessionV2.create` gained a real typed sandbox failure. The existing Workflow compatibility-host caller forwarded it without translating the new boundary into its domain error.
- **Fix:** Catch only `CommandSandbox.Failure` at the host creation call. Translate unavailable storage to Workflow storage failure and other policy rejection to Workflow invalid failure, with a safe inheritance-specific message. Preserve Session not-found and existing unrelated errors.
- **Reproduction:** Typecheck `packages/server` with the typed native creation implementation and the original unadapted Workflow host creation call.
- **Verification:** Private Server and Apexo package typechecks passed after the narrow mapping. No provider retries, permissions changes or unconfined fallback are added.
- **Occurrences:** One draft type-contract integration episode; no recurring constraint promoted.
