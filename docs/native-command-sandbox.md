# Native command and whole-agent sandbox

This G02 slice (`R07`, `R08`) is integrated across CLI and rebuilt Desktop backend acceptance.

Native Session creation accepts `commandSandbox: "off" | "workspace" | "read-only" | "strict" | "devbox" | <custom-profile-name>` (plus `"none"` normalized to `"off"`). A new root defaults to an explicit stored `off` policy (or configured `sandbox.mode` / `GROK_SANDBOX_MODE`). Existing IDs adopt immutable stored authority; conflicting explicit selection fails. New trusted children inherit through an opaque parent capability, with policy and `Created` projection committed in the same transaction. No policy is inferred from mutable metadata or repaired at execution time. The migration seeds `off` only for pre-existing Sessions with a unique valid durable `Created` proof. Unverifiable historical Sessions remain unavailable.

## Profiles, `sandbox.toml` and deny globs (`R08`)

Built-in confined profiles are:
- `workspace`: read access across the host; write access restricted to the canonical workspace and private temporary directory; network disabled by default.
- `read-only`: read access across the host; write access restricted to the private temporary directory; network disabled by default.
- `strict`: read access restricted to the canonical workspace, configured `read_only` / `read_write` directories, and essential system runtime roots; write access restricted to the private temporary directory (plus configured `read_write` roots); network disabled by default.
- `devbox`: extends `workspace` with `network: "unrestricted"` unless overridden.

Host (`$GROK_HOME/sandbox.toml`) and project (`.grok/sandbox.toml`, `.apexo/sandbox.toml`) files may define `[filesystem].deny` and `[profiles.<name>]` (`extends`, `read_only`, `read_write`, `deny`, `restrict_network`). Deny entries are unioned across layers (tighten-only; no profile can un-deny a path), and protected control files (`.git`, `.env`, `.env.*`, `.grok/hooks`, `.grok/sandbox.toml`, `.apexo/sandbox.toml`, `.claude/settings*.json`, `.cursor/hooks.json`, `apexo.json`, `apexo.jsonc`, and symlink targets) are always write-protected.

## Kernel (`seatbelt` / `bwrap`) and whole-agent tool enforcement (`R07`, `R08`)

- **macOS (`seatbelt`)**: `CommandSandboxSeatbelt` generates `/usr/bin/sandbox-exec` SBPL profiles enforcing literal and regex (`denyGlobs`) read/write denials, `strict` read-root allowlists, workspace/read-only write rules, protected control paths, and network confinement.
- **Linux (`bwrap`)**: `CommandSandboxLinux` builds `bwrap` (`bubblewrap`) arguments with `--unshare-all` (or `--share-net` when `network === "unrestricted"`), `--die-with-parent`, `--new-session`, read-only root/system binds, writable workspace and `readWrite` binds, read-only mounts over protected files/ancestors, and tmpfs/dev-null masks over `denyLiterals`.
- **Whole-agent in-process tools (`R07`)**: `CommandSandbox.Service` exposes `assertRead`, `assertWrite`, `assertDirectory`, `assertNetwork`, and `filterPath`. All native in-process tools (`read`, `write`, `edit`, `apply_patch`, `glob`, `grep`, `webfetch`, `websearch`, `media`, `lsp`, `mcp-tools`, `mcp-resources`) enforce the Session's immutable sandbox policy before performing filesystem or network I/O, including dangling symlink canonicalization (`BUG-20261016-387`).

Passive `GET /api/session/:sessionID/sandbox` distinguishes stored policy, unchecked/available backend (`seatbelt` on macOS, `bwrap` on Linux) and latest confirmed completed execution. It launches no process and performs no provider work. Receipts are process-local and reset on restart.

## Evidence

- Focused unit, adversarial, and E2E sandbox suites (`packages/apexo`): **16 passed, 0 failed, 157 assertions** across `command-sandbox-whole-agent.test.ts`, `command-sandbox-paths.test.ts`, `command-sandbox-bash.test.ts`, `command-sandbox-launcher.test.ts`, `command-sandbox-store.test.ts`, `command-sandbox-creation.test.ts`, and `command-sandbox-native-create.test.ts`.
- Live isolated CLI and rebuilt Desktop acceptance (`bun script/grok-native-command-sandbox.mjs cli` and `desktop`): **8/8 checks, 10 provider calls each**, covering default `off`, `workspace` and `read-only` Seatbelt execution, custom `.grok/sandbox.toml` profile with `deny = ["secrets/**"]`, whole-agent in-process `write` and `webfetch` enforcement, existing-ID adoption/conflict, compatibility shell rejection, crash/reopen receipt reset, and deleted-ID reuse.
- Installed Grok Build comparison (`bun script/grok-command-sandbox-official.mjs`): **3/3 profiles (`workspace`, `read-only`, `audit-deny`), 4 provider calls**.
- See [Phase 3 sandbox and admin policy audit](testing/runtime/phase3-sandbox-and-admin-policy-audit.md) (`BUG-20261016-387`).
