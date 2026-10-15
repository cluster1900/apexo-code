# BUG-20261014-066: Host hook configuration and permission decisions were not integrated

- Scope: Grok Build host hooks, plugin adapter, legacy session tool boundaries, permission service.
- Observed behavior: Source audit found that only installed plugin-bundle hooks loaded. Global Grok JSON/TOML hook sources were ignored, updatedInput was rejected, and ask could not force a fresh permission decision after existing approvals. Simple matcher names were treated as regex substrings.
- Expected behavior: Discover host sources under the Grok profile, require host trust for project hooks, apply rewrites before validation and permission evaluation, and preserve explicit ask/deny behavior.
- Reproduction: Configure global PreToolUse command hooks with an exact Read matcher, updatedInput pointing to a different file, and permissionDecision ask. Previously no host hook ran. A direct installed-bundle rewrite was explicitly rejected.
- Root cause: The original six-event adapter targeted plugin bundles only, and the permission service had no internal forced-ask mode.
- Fix: Add host discovery/inspection and profile-scoped loading; host-specific gate/error semantics; exact matcher and alias support; rewrite policy tracked per argument object; move MCP resource parsing after hooks; revalidate rewritten built-in input; force permission requests while retaining denials and isolating concurrent approvals. Installed-bundle behavior remains covered by its existing tests.
- Verification: The focused host hooks, plugin store, permission, and session tools suites pass 100 tests and 193 assertions. Package typecheck passes. CLI rewrite fixture verifies that permission patterns name the rewritten file and execution returns only that file after explicit approval. Official and final Desktop acceptance are tracked in the hooks parity document.
- Occurrences: One implementation-gap audit, no claimed historical production incident. No recurring constraint is promoted.
