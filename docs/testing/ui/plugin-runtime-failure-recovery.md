# BUG-20261014-182: Successful Plugin activation could retain a stale UI failure

- Scope: App/Desktop and shared terminal native Plugins runtime snapshots.
- Observed: static review found that runtime responses were assigned with Solid store merging. After a failed activation, a successful response omits the optional `failure` field; a merge can retain the old failure even though the backend has cleared it.
- Expected: each runtime response replaces the previous snapshot shape, including removal of an absent optional failure.
- Reproduction: apply a supported bundle, enable an unsupported MCP bundle, attempt Apply, disable the unsupported bundle, and Apply again. The final snapshot has no failure and the UI must remove its previous error.
- Root cause: `setState` object merging preserves properties omitted from the next object. A server snapshot is a replacement, not a partial patch.
- Fix: reconcile the complete runtime snapshot in both App and terminal state. Fixtures now exercise failure followed by successful recovery and assert removal of the failure display.
- Verification: corrected compact and expanded native-action PTY commands each passed six checks, including failed activation followed by successful recovery clearing both failure and action error. Both were reaped. Production browser and actual macOS Electron commands `bun script/grok-native-plugins-ui.mjs desktop --locales` and `bun script/grok-native-plugins-ui.mjs native --locales` each passed eight checks, including removal of the failure display after successful recovery. The recovery ran after localized panel reloads, confirming state replacement in a fresh view as well. Both fixtures were reaped. This was discovered through source review; no prior passing run is claimed as a failure reproduction.

After native bundle MCP support was added, the unsupported-capability fixture
moved to a valid LSP bundle. Both compact and expanded real terminal action
fixtures passed six checks each, including failed-apply snapshot preservation
and successful recovery clearing the optional failure. They also exercise the
shared protocol-health selector. This is regression coverage of the same store
reconciliation fix, not a new occurrence. The earlier MCP case remains historical
evidence from before MCP support.

When native stdio LSP support landed, a valid LSP definition with an unavailable
command no longer represented an unsupported capability: it represented a load
failure. Source review identified this stale fixture assumption before the final
checkpoint. The unsupported definitions in native Plugins CLI, App, and terminal
fixtures now explicitly request a non-stdio transport (`tcp`); the native bundle
runtime fixture does the same. The dedicated LSP adapter test also covers the
reference's actual `socket` transport spelling. `bun script/grok-plugins-native.mjs cli`
passed all 13 scenarios with three provider calls after the update, including
unsupported failure retaining the previous active snapshot. This is fixture
maintenance of the existing recovery coverage, not a recurrence of the Solid
store bug or a claim that all LSP configurations remain unsupported.
