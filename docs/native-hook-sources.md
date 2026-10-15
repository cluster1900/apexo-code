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

## Boundaries and verification

Administrator-enforced sources remain unimplemented. They require an authenticated Apexo policy capability; this slice does not treat user-owned requirements, signed-looking fields, managed filenames or environment settings as that capability. Parent-directory authorization remains a separate design requiring explicit repository-bound consent.

The pinned reference's `xai-grok-config/src/loader.rs` describes additive config layers and duplicate provenance ranks; `xai-grok-hooks/src/discovery.rs` describes global/project import ordering and replacement in the original duplicate slot. Apexo intentionally requires host opt-in with a default of false rather than inheriting the reference's broader compatibility defaults.

Validation from package directories:

- Core and Apexo `bun typecheck`: passed.
- Hook source, deduplication, host dispatch, environment, snapshot and preferences tests: 31 passed, 140 assertions. The four initial feature tests failed against the previous loader. A further failing-before settings-directory regression and an explicit flat Cursor grammar control are included.
- `bun script/grok-hook-sources-native.mjs cli`: four checks passed with six real provider calls, including command traces, import reload, disable retention and terminated Hook PIDs.
- Unified rebuilt Desktop passes the same four checks / six provider calls after the Feedback, Workflow resume and Shell wait composition.
- Shared integration repeats the six-file 31-test / 140-assertion gate, Core/Apexo typechecks and native CLI four-check / six-call acceptance successfully. The nine baseline/final file hashes were verified before copying.
- The isolated installed Grok 1.0.52 comparator completed three scenarios (two conversation requests) and confirms opt-in global and trusted-project grouped Claude/Cursor imports. It differs from the pinned source: this fixture's user requirements/managed Hook layers do not execute, environment-distinct user/file copies remain separate, headless Stop dispatch appears twice, and malformed requirements abort startup with exit 2. Apexo follows the pinned additive-layer/raw-identity discovery contract. These differences are preserved as comparison evidence, not hidden behind a parity claim.

See [fixture corrections](testing/test-fixtures/hook-source-fixture-assumptions.md) and the [settings-source kind regression](testing/runtime/hook-settings-source-kind.md). The installed-runtime script is a comparison fixture only and does not verify Apexo's implementation.
