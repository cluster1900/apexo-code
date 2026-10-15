# BUG-20261014-067: Isolated Grok configuration still inherited the real user home

- Scope: Installed-official Hooks comparison fixture; the same environment pattern was found statically in the feedback and Goal comparison fixtures.
- Observed behavior: Hooks comparison stderr showed the installed runtime scanning the real user's Claude plugin catalog even though GROK_HOME pointed to the fixture. No private uploads or execution of those unrelated plugins were observed.
- Expected behavior: Protocol comparisons load only fixture-owned host configuration and plugin sources.
- Reproduction: Launch the installed official ACP runtime with isolated GROK_HOME but inherited HOME on a host that has Claude plugin configuration.
- Root cause: Official compatibility discovery uses the user home independently of GROK_HOME.
- Fix: Set HOME and APEXO_TEST_HOME to the fixture directory alongside GROK_HOME. Apply the same isolation to the feedback fixture based on the shared environment pattern. The Goal fixture also sets HOME to its isolated GROK_HOME.
- Verification: The hardened Goal fixture passed `bun script/grok-goal-official.mjs --execute --workspace` from `packages/apexo`: three checks and 22 provider requests. Other hardened fixture reruns are recorded by their owners. The original Hooks fixture's stderr is the observed evidence; the feedback and Goal findings are static audits, not an additional observed occurrence.
- Occurrences: One observed Hooks fixture contamination. No recurring constraint is promoted.

The hardened feedback fixture also passed `bun script/grok-feedback-official.mjs` from `packages/apexo`: three scenarios and ten provider requests with HOME, APEXO_TEST_HOME, GROK_HOME and XDG directories isolated. It validates local creation, exact-ID replacement with ID stripping, and rejection of a missing update target. This confirms the hardened fixture's result; the static finding remains uncounted as a separate observed occurrence.

Hooks verification: the hardened fixture directly launched the installed executable and passed all eight scenarios. Its stderr contained the expected unsupported-handler warnings and no real-user Claude plugin catalog paths.

Media verification: the hardened fixture directly launched the installed executable with isolated HOME and passed all four media scenarios against synthetic local endpoints. The extended hardened Hooks run subsequently passed ten scenarios, including Stop continuation and its bound. These reruns verify isolation corrections and do not add observed contamination occurrences.

Task reference static audit: the new off-tree Task fixture already isolated HOME and GROK_HOME but inherited all XDG paths and hard-coded workspace module paths. The integrated comparison-only `grok-native-task-official.mjs` uses package-relative imports, an explicit `GROK_BIN` override and isolated HOME/GROK_HOME/all five XDG directories. A duplicate set of identical XDG properties in the sandbox comparison was removed without changing their values. No real-profile access was observed in either audit, so the observed contamination count remains one. The portable Task fixture passed five checks with three child requests and 29 total requests; the sandbox comparison passed its scoped outcomes with four provider calls. Both completed with isolated environments. These reruns do not increase the observed contamination count.


The closing-summary comparison received the same static hardening: an explicit `GROK_BIN` override and all five XDG directories under its isolated home. No real-profile access was observed, so this does not increase the occurrence count. Its hardened installed-runtime rerun passed two checks / 24 total provider requests with clean exit.

Native media comparison static audit: `grok-media-official.mjs` already isolated HOME/GROK_HOME but inherited XDG paths. It now isolates all five XDG directories and disables unrelated compatibility discovery for the local comparison. The hardened installed-runtime run passed all four media scenarios. This is a static hardening and verification result, not a newly observed profile-access incident; the observed contamination count remains one.
