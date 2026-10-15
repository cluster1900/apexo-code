# Native plugin workspace activation

A trusted plugin may declare `workspaceFolder` and `workspaceOpen` in its LSP configuration. Snake-case aliases are accepted; specifying both spellings of one field is invalid. Relative workspace folders resolve against the active Location, and relative solution/project files resolve against the effective workspace folder. The Session and Location identity do not change. Plugin-root placeholders resolve against the captured installed package root.

Servers with these settings remain **Pending** until an LSP tool invocation authorizes the canonical workspace root and every configured solution/project target. The native tool applies current `read`, `lsp`, and, for external targets, `external_directory` permissions. It rechecks authority after waiting for another activation and after retry backoff, before starting a process. A one-time answer is scoped to that invocation; a later deny wins. Changed canonical targets require explicit reload. Ordinary servers retain their existing startup behavior.

After authorization, the native client sends the effective root in `initialize.rootUri` and `workspaceFolders`, then sends configured `solution/open` and `project/open` notifications after `initialized`. The existing Location-scoped LSP owner handles cancellation, shutdown, reload and disposal. A crashed workspace server does not restart passively with an old Session's approval. A subsequent authorized invocation may retry within its configured lifetime restart budget. Reload resets that budget; a successful retry does not.

App status displays the existing translated “Waiting for authorization” label with a neutral indicator. This key is present in all 62 App locale dictionaries. The TUI's existing LSP status view consumes the compatibility LSP contract, which does not expose this new native pending state.

## Reference evidence and scope

The reference is Grok Build commit `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, compared with installed Grok 1.0.52. Relevant fixed-source paths, relative to that checkout:

- `crates/codegen/xai-grok-tools/src/implementations/lsp/config.rs:216`: stdio/socket transport and workspace configuration; `effective_root` is at line 294.
- `crates/codegen/xai-grok-tools/src/implementations/lsp/client.rs:201`: transport dispatch; initialize root/folders at line 219; workspace opening after initialization at line 335; TCP connection at line 482.
- `crates/codegen/xai-grok-tools/src/implementations/lsp/workspace_open.rs:32`: `solution/open` and `project/open`, with relative targets resolved against the effective root.

An isolated installed-runtime plugin test passed five checks: actual hover output, TCP transport, effective initialize root/folder, solution opening and project opening. It used a fresh home, isolated XDG directories, denied access to the personal home, and egress limited to owned localhost provider/LSP fixtures. Reference results do not count as Apexo verification. TCP transport is a separate native follow-up; this slice continues to reject it explicitly.

## Marketplace audit boundary

No working export, download-transfer or cache-prune command was demonstrated in the fixed reference. Both installed `grok plugin --help` and `grok plugin marketplace --help` exited successfully and exposed none. The supporting fixed-source entry points are:

- `crates/codegen/xai-grok-pager/src/plugin_cmd.rs:84`, `PluginCommand`: list, install, uninstall, update, enable, disable, details, validate, tag and marketplace.
- The same file at line 167, `MarketplaceCommand`: list, add, remove and update.
- `crates/codegen/xai-hooks-plugins-types/src/lib.rs:1174`, `MarketplaceAction`: refresh, install, update, uninstall, add-source and remove-source.
- `crates/codegen/xai-grok-shell/src/extensions/marketplace.rs:113`: exhaustive dispatch of those ACP actions.

These hypothetical actions are **not demonstrated reference gaps**, and no export or destructive cache sweep is added. Apexo already supports custom/recommended catalogs, immutable untrusted downloads and an explicit trusted installation step. Existing package snapshots may remain referenced by running Location generations, so registry removal alone is not authority to delete their files. The user-facing reference source-removal/uninstall behavior is distinct from a general cache-prune capability.

## Shared integration acceptance

Shared integration passes the combined Task/LSP gate (55 tests / 565 assertions) and the existing LSP policy cases in the separate Memory/LSP policy gate (62 tests / 311 assertions total). All 21 workspace types, canonical generators/client consistency and unified App/Desktop builds pass. Source CLI and the rebuilt Desktop backend each pass six checks / eight provider calls. The isolated installed comparator remains five checks / three calls. Socket transport is still separate work.
