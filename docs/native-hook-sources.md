# Native Hook source layers and trusted imports

The Grok Build profile discovers Hook definitions through Apexo's existing host loader and captures them in the Session-owned registry. There is no dependency on an installed Grok executable. The Apexo profile's host-hook activation behavior is unchanged.

## User-controlled sources

Host discovery reads these additive layers, without merging their Hook arrays into one configuration value:

1. `$GROK_HOME/requirements.toml`: unsigned user requirements.
2. `$GROK_HOME/config.toml`: user configuration.
3. `$GROK_HOME/managed_config.toml`: user-owned managed defaults.
4. Sorted JSON files in `$GROK_HOME/hooks`, then absolute registered `hooks-paths` sources.
5. Explicitly enabled global vendor files, then exactly trusted workspace files.

Absent `GROK_HOME`, the host user's `.grok` directory is used. Settings candidates must be regular files; a directory at a config or vendor settings filename is not scanned. A malformed file is diagnosed independently of other layers. Malformed event groups do not erase valid peer events. Only the existing supported command/HTTP handler and event grammar is accepted; this feature does not interpret arbitrary vendor settings as commands.

Distinct handlers remain additive. Duplicate identity uses the canonical event, raw command, raw URL and configured matcher before environment expansion. Environment and timeout are not identity fields. User managed defaults outrank unsigned user requirements, which outrank user configuration, which outranks file sources. A stronger duplicate replaces the original deterministic execution slot and keeps the winning source's original handler identity, environment and timeout. Equal rank keeps the first copy. This is duplicate precedence, not ordinary configuration-value precedence or permission authority. Installed plugin sources retain their separate append behavior.

The loader stamps immutable provenance from its own candidate construction. Raw `policy`, `provenance`, filenames and ordinary environment variables never confer administrator enforcement. All sources added here remain configurable and honor both `enabled: false` and saved user disable choices. Existing sanitized inspection shows the winning source/name without exposing command text, URLs or environment values.

## Explicit imports

Only the host-global `$GROK_HOME/config.toml` may enable imports:

```toml
[hooks.imports]
claude = true
cursor = false
```

Both flags default to false and require literal booleans. Managed defaults, unsigned requirements, registered files and project configuration cannot turn them on. Claude reads `.claude/settings.json` and `.claude/settings.local.json`; Cursor reads `.cursor/hooks.json`. Imported files use the supported grouped handler grammar, including the existing Cursor event aliases. Native flat Cursor entries such as `beforeShellExecution: [{ command: "..." }]` are diagnosed and do not execute; the pinned reference parser also requires matcher groups containing a `hooks` array. This is not a full translator for arbitrary native Cursor configuration. Global files are relative to the host user home, independently of a custom `GROK_HOME`. The native Location loader supplies its existing host `Global.home` value.

Workspace imports require both the host setting and the existing exact canonical workspace `trusted=true` grant in the host-global `trusted_folders.toml`. The project file order is Claude settings, Claude local settings, native `.grok/hooks`, then Cursor hooks. Project `.grok/config.toml` is not a Hook configuration layer. Parent-folder grants are not inherited, and project trust files are not consulted.

## Capture and reload

Executing a Session captures definitions and effective preferences. Passive inspection and subsequent dispatch do not rediscover files. Explicit serialized reload rechecks import flags and exact workspace trust, then publishes a complete replacement through the existing Session Hook snapshot service. Changing files alone does not modify an existing captured registry. Turning imports off or revoking trust removes their definitions on reload, while saved disable choices remain intact. New Sessions capture the current configuration.

## Administrator-enforced Hook layers and organizational Plugin policy (`R09`)

Host discovery supports three administrator-enforced Hook layers above user-controlled sources:

1. `$GROK_SYSTEM_CONFIG_DIR/requirements.toml` (default `/etc/grok/requirements.toml`, provenance `system_requirements`, rank `5`).
2. `$GROK_HOME/requirements.signed.toml` verified against `$GROK_HOME/requirements.signed.toml.sig` using an Ed25519 public key from `GROK_REQUIREMENTS_PUBLIC_KEY`, `$GROK_SYSTEM_CONFIG_DIR/requirements.pub`, or `$GROK_HOME/requirements.pub` (provenance `signed_requirements`, rank `6`).
3. `$GROK_SYSTEM_CONFIG_DIR/managed_config.toml` (default `/etc/grok/managed_config.toml`, provenance `system_managed`, rank `7`).

Duplicate handler precedence across all layers is `system_managed (7) > signed_requirements (6) > system_requirements (5) > user_managed (4) > user_requirements (3) > user (2) > file (1)`. Administrator layers stamp `policy: "managed"` (`configurable: false`, `readOnlyReason: "managed"`), cannot be disabled by `enabled: false` or user preferences (`SessionHookSnapshot.preference` fails with `read_only`), and cannot be spoofed by raw `policy` or `provenance` fields in user/project/file sources.

When `fail_closed = true` (or `GROK_REQUIREMENTS_FAIL_CLOSED=1`) is active and `requirements.signed.toml` is missing or fails Ed25519 verification, or when any layer sets `allow_managed_hooks_only = true` (tighten-only), all non-managed user, vendor import, project, and plugin bundle hooks are suppressed while administrator-managed hooks remain active.

Organizational plugin policy (`PluginStore.loadPolicy` in `packages/core/src/plugin-store.ts`) enforces:
- `strict_known_marketplaces` and `extra_known_marketplaces` (allowing only listed marketplaces plus the official marketplace when strict mode is enabled).
- Tighten-only `require_sha = true` / `GROK_MARKETPLACE_REQUIRE_SHA=1` requiring a pinned 40-character hexadecimal Git commit SHA on plugin installs and updates (across both `url` and `path` catalog entries).
- `disable_plugins` / `disabled_plugins` / `[plugins].disabled` blocking installation, enabling, and runtime activation (`PluginStore.active` and `PluginStore.capture`) while preserving already-captured in-flight reader leases (`BUG-20261016-387`).

## Verification

- Core and Apexo `bun typecheck`: passed (`21/21` workspace tasks).
- Hook and Plugin unit, adversarial, and E2E suites (`packages/apexo`): **49 passed, 0 failed, 207 assertions** across `hook-admin-policy.test.ts`, `plugin-admin-policy.test.ts`, `hook-sources.test.ts`, `hook-preferences.test.ts`, `hook-repository-trust.test.ts`, `store.test.ts`, and `host-hooks.test.ts`.
- `bun script/grok-hook-sources-native.mjs cli` and `desktop`: **5/5 checks passed, 7 provider calls each**, including additive layers, trusted imports, disable retention, Ed25519 `signed_requirements`, and `allow_managed_hooks_only`.
- `bun script/grok-plugin-data-native.mjs cli` and `desktop`: **6/6 checks passed, 7 provider calls each**, including persistent plugin data epochs, active-reader retention, `strict_known_marketplaces`, and `disable_plugins`.
- See [Phase 3 sandbox and admin policy audit](testing/runtime/phase3-sandbox-and-admin-policy-audit.md) (`BUG-20261016-387`), [fixture corrections](testing/test-fixtures/hook-source-fixture-assumptions.md), and the [settings-source kind regression](testing/runtime/hook-settings-source-kind.md).
