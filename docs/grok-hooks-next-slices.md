# Remaining Hooks implementation slices

This is a read-only planning checkpoint after the verified environment and HTTPS slices. It does not claim implementation or authorize changes to shared Session/API ownership. Apexo remains authoritative for execution, permissions, Sessions, and persistence; the official source/runtime is comparison evidence only.

## Recommended next slice: duplicate host-hook resolution

Implement raw-content duplicate resolution across the host sources Apexo already supports. This is a complete, useful configuration behavior that does not require a new public API, managed authority, Session runner changes, or a management UI.

The pinned reference `xai-grok-hooks/src/discovery.rs` lines 161–275 and 406–419 assembles config layers before global files and trusted project files, then deduplicates by canonical event, raw command, raw URL, and configured matcher. Timeout and environment are deliberately excluded from identity. Equal-authority duplicates retain the first copy; stronger policy provenance can replace it. Current Apexo discovery concatenates sources and expands strings before dispatch, so identical hooks in several supported sources can execute more than once.

The bounded implementation should preserve raw identity until duplicate resolution, prefer the existing global config source over its identical file copy, preserve first-source ordering among current file sources, and only then expand environment values. Distinct events, raw commands, URLs, or matchers must remain distinct. Invalid or unsupported handlers must not shadow a valid handler. Project sources remain gated by exact host trust. Installed plugin bundle hooks remain separate: the reference plugin adapter's `replace_plugin_hooks` appends plugin specs after replacing the plugin layer rather than applying this host-source deduplication again.

Ownership:

- Media/Hooks agent: `packages/core/src/hooks.ts`, optional internal `packages/core/src/hook-registry.ts`, and focused host discovery tests/scripts.
- Existing `hook-environment.ts` may supply preparation after resolution; its expansion contract must remain unchanged.
- No planned edits to `llm.ts`, public API aggregates, migrations, root configuration, or generated clients.
- Preserve the winning source's original identity through filtering so the inspection name and GROK_HOOK_NAME remain consistent. Do not derive stable names from a newly compressed array index.

Acceptance:

- Unit: identical config/file copies execute once; first copy's environment/timeout wins; alias event spelling does not create duplicates; distinct matcher/event/raw expression stays distinct; untrusted project content cannot affect a trusted winner; unsupported content cannot suppress valid execution.
- CLI and production Desktop: real command traces from an actual Session demonstrate one execution for duplicates and both executions for distinct hooks, with the winning environment value. Inspect the sanitized API view without exposing commands/environment.
- Installed comparison: isolate HOME/GROK_HOME, use local synthetic provider traffic, and run the same duplicate/first-winner/distinct-hook cases. Record any installed/source differences explicitly.
- Run the related Hooks batch and package typecheck, then request the common Desktop build. No source/test edits during the acceptance freeze.

## Subsequent gaps and integration boundaries

| Slice | Current gap | Smallest complete behavior | Ownership/API risk |
| --- | --- | --- | --- |
| Session snapshot and explicit reload | Legacy host hooks are loaded per instance; Core Stop and permission/cancellation observers discover per dispatch. | One Session/Location-owned snapshot shared by all host dispatch paths; new Session loads current files; same Session retains its snapshot until an explicit serialized reload rechecks trust and replaces the complete registry. | New Core Session hooks service plus legacy adapter and observer/Stop consumers. Parent must coordinate V1/V2 initialization and serialized reload admission. Avoid a process-global mutable cache, silently evicting active snapshots, or persisting command/env secrets in an API-visible record. |
| Additional config layers | Only user config and documented hook files load today. | Add additive supported host-owned layers with explicit provenance, then authority-aware duplicate resolution. | Core discovery/config ownership; parent coordination for Apexo's managed configuration source and any schema fields. A user-writable requirements/managed filename alone must never confer non-disableable policy authority. |
| Managed enforcement | No signed-policy authority or managed-only enforcement is represented. | A verified Apexo policy source determines whether hooks are non-disableable and whether ordinary sources are suppressed. | Requires product-owned policy/trust design. Do not port Grok's runtime/signature service or label unsigned user files as administrator policy. |
| Vendor imports | Claude/Cursor hook sources are not discovered. | Explicit compatibility settings and import-state semantics determine global and trusted-project vendor sources, using the same discovery and dedup pipeline. | Parent approval for public configuration fields and defaults; generated schema/client work if exposed. Never read unrelated user vendor homes from comparison fixtures. |
| Manager | GET /hooks is a sanitized configuration inspection view. | List effective source/status with diagnostic reasons, persistent enable/disable, and explicit reload that applies to a selected Session safely. | `packages/schema/src/host-hooks.ts`; legacy experimental group/handler/path files under `packages/apexo/src/server/routes/instance/httpapi`; parent owns aggregate/API generation. UI agent owns settings/Session management surface. Read-only inspection must not execute hooks or expose credentials. |
| Native lifecycle | V2 covers Stop, actual permission outcomes/prompts, and explicit main cancellation; other legacy lifecycle boundaries are not native parity. | Add one real lifecycle boundary at a time, using actual Session/tool state and the shared snapshot. | Native runner remains parent-owned. Tool authorization stays in leaves; registry metadata does not become authorization. Public admission and durable trusted context must remain separate. |
| Child lifecycle | No real SubagentStop gate. | Gate genuine child completion separately from main Stop, with bounded durable trusted continuation and explicit cancellation/budget behavior. | Coordinate native child execution and Workflow/Goal role accounting; no synthetic user prompt and no observer-only substitute for a gate. |

Reference snapshot semantics include explicit reload: `xai-grok-hooks/src/discovery.rs` lines 11–14 describes the point-in-time registry, and `xai-grok-shell/src/session/acp_session_impl/hooks_plugins.rs` lines 727–775 re-discovers sources, re-evaluates project trust, appends current plugin hooks, swaps the registry, and reports updated inspection state on the serialized command loop.

Reference authority is distinct from merge precedence. `xai-grok-config/src/loader.rs` lines 230–278 treats only system-managed, system requirements, and verified signed requirements as non-disableable policy. Unsigned user requirements and user managed defaults remain user-controlled. Its duplicate authority rank is not ordinary config merge precedence.

The pinned reference does not add project config TOML hook tables through its hook-layer loader, and it rejects prompt/agent handler types. Those should not be expanded into presumed migration requirements.

## Session snapshot service checkpoint

Raw-content deduplication is accepted in CLI (4), production Desktop (4), and the expanded official comparison (20). The installed-version environment/timeout difference remains documented in the parity report.

The standalone `SessionHookSnapshot` service now provides scoped Location registration, Session capture, read-only lookup, explicit reload, and Session/Location release. Capture clones and freezes the complete registry while preserving non-enumerable handler identity. Per-Session serialization shares initial capture; failed or interrupted reload retains the prior registry. Cleanup invalidates pending publication and is identity-specific, so a stale owner cannot remove a replacement. Location registration and the global service both install scope cleanup.

The authorized Location loader is supplied to `registerLocation(location, loader)`; the resulting owner capability is required by `capture(owner, sessionID)` and `reload(owner, sessionID)`. Reload requires a previously captured Session and does not admit input, schedule a drain, or call a provider. The coordinator must serialize it at the execution boundary. `get(sessionID)` never performs discovery. Explicit Session deletion and Location disposal must invoke the corresponding release lifecycle.

Runtime consumers now capture at actual native or compatibility drain entry. Admission alone does not initialize the registry. Stop gates and permission/cancellation observers consume the captured registry and never rediscover implicitly. Compatibility host prompt hooks run at execution, while ordinary plugin chat callbacks retain their admission timing. Session deletion invalidates the registry after interrupting native execution; this does not establish a concurrent-deletion admission fence.

Native and compatibility management routes expose `GET /api/session/:sessionID/hooks` / `GET /session/:sessionID/hooks` and the corresponding `POST /reload`. Inspection reports captured state, generation, and sanitized effective metadata without discovery. Reload requires an existing snapshot, performs no provider work, rechecks Location ownership and trust, and publishes an atomic replacement. Native reload uses the Session control coordinator. Compatibility reload queues at a provider boundary or final handoff; idle reload executes without starting a drain. Uncaptured Sessions and cancelled queued requests return a conflict.

Verification checkpoint: the compatibility prompt/Runner/snapshot batch passed 117 tests (one pre-existing skip), 530 assertions. After adding all-message retry receipts, the focused adapter/Runner/snapshot batch passed 34 tests and 104 assertions. CLI management passed nine scenarios, including active-provider reload and one SessionStart per Session. Installed Grok comparison passed 22 scenarios, including existing-Session retention and fresh-Session discovery. The five focused hook HTTP scenarios passed. The final focused batch including the compatibility Location map override passed 35 tests / 105 assertions; the shared HttpApi Location lifetime regression passed 1 test / 2 assertions, and all six compatibility provider HTTP scenarios passed. Final Apexo package typechecking exited 0. Production Desktop backend acceptance passed all nine snapshot/reload scenarios against the common compiled artifact. Native App/TUI interaction acceptance is tracked separately by the UI owner.
