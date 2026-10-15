# BUG-20261015-086: App sandbox selection crossed an older vendored client contract

- Scope: off-tree App command-sandbox UI integration; one authoring episode.
- Observed: App typechecking rejected `commandSandbox` in the vendored promise client's `SessionCreateInput`. Routing the selected creation through the current generated SDK then exposed the generated `SessionV2Info` versus vendored `SessionInfo` revert-file type difference. The native prompt adapter also required copying readonly attachment arrays for the generated mutable-array input.
- Expected: the UI uses the current public sandbox API without casts, vendor edits, or silently discarding the selected profile.
- Root cause: the App intentionally consumes an older vendored promise client, while the repository-generated v2 SDK describes the current endpoints.
- Fix: selected non-off creation uses the current generated v2 SDK. Off creation preserves the existing compatible API path. `normalizeSessionInfo` accepts both public input types and retains its existing field mapping; it already does not copy incompatible revert-file details. Attachment arrays are copied at the native prompt boundary.
- Verification: `bun typecheck` in `packages/app` passes. `bun script/grok-native-sandbox-ui.mjs browser --locales` in `packages/apexo` passes seven checks, including real off/workspace/read-only creation and three ordinary provider roundtrips. The selected-create failure remains visible and never falls back to off.
- This was a draft integration failure, not a shipped authorization defect. No recurrence promotion.
