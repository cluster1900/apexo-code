# Issue #187 — Versioned Plugin Ecosystem and Compatibility Validation

**Status:** development design and implementation audit
**Priority:** P1
**Scope:** plugin manifest, SDK versioning, capability/permission declaration, discovery, installation and rollback

## 1. Problem

Apexo already has plugin hooks for tools, providers, auth, commands, agents, skills, MCP, LSP and workspace adapters. The current ecosystem is operational but not a stable distribution contract: plugin metadata, capabilities, permissions, source trust, SDK compatibility and rollback are not represented uniformly. A plugin must be installable and reviewable without giving it raw Session, credential or filesystem access.

## 2. Current implementation audit

### Done

- Public plugin types and hooks are exported from [`packages/plugin/src/index.ts`](../../../packages/plugin/src/index.ts) and V2 types from [`packages/plugin/src/v2`](../../../packages/plugin/src/v2).
- Plugin source, catalog, install/update/enable/disable state and runtime failures are modeled in [`packages/schema/src/plugin-store.ts`](../../../packages/schema/src/plugin-store.ts).
- Installation, source normalization, trust policy and registry persistence are implemented in [`packages/core/src/plugin-store.ts`](../../../packages/core/src/plugin-store.ts).
- Bundle staging and atomic activation/retirement are handled by [`packages/core/src/plugin-bundle-state.ts`](../../../packages/core/src/plugin-bundle-state.ts) and [`packages/core/src/plugin-bundle-runtime.ts`](../../../packages/core/src/plugin-bundle-runtime.ts).
- Plugin HTTP handlers and Desktop/CLI plugin commands exist in [`packages/server/src/handlers/plugins.ts`](../../../packages/server/src/handlers/plugins.ts) and [`packages/apexo/src/cli`](../../../packages/apexo/src/cli).
- Plugin tests cover store, install, trust, hooks, lifecycle and reload under [`packages/apexo/test/plugin`](../../../packages/apexo/test/plugin).

### Partial or missing

- `PluginStore.Item` and `Plugin.ID` do not form a complete signed manifest with SDK range, entrypoint, capability version, dependency lock or permission scopes.
- Trust exists, but users do not get a normalized permission/data-flow diff before installation or upgrade.
- Runtime activation is transactional for configured bundles, but third-party code still runs in the host process and has broad access through plugin context.
- Compatibility failures are summarized as runtime failures; there is no machine-readable conformance report or migration hook contract.
- Local/project sources are supported; a reproducible lockfile and offline installer contract are incomplete.

## 3. Manifest and lifecycle

Add a versioned manifest, for example:

```text
PluginManifest
  id, name, version, sdkRange, manifestVersion, entrypoint
  capabilities[{kind, name, version}]
  permissions{filesystem, network, process, credentials, sessionData}
  dependencies[{id, range, integrity}]
  source{type, url/path, revision, integrity}
  platforms, license, signature, migrations
```

Lifecycle state is `discovered → validated → approved → installed → enabled → active`, with terminal `disabled`, `failed`, `uninstalled` and `rolled_back`. Every mutation has an operation ID and is idempotent. Activation must stage a complete candidate and publish it atomically; a partial candidate must never register some hooks while leaving others from the old generation.

## 4. Permission and host bridge

The plugin host should expose narrow contexts: `SessionContext`, `ToolContext`, `CredentialRef`, `WorkspaceAdapter`, `HttpClient` and `EventPublisher`. Each method checks the parent Project/Location/Session policy and emits an audit event containing plugin ID, manifest version and capability. Raw API keys, refresh tokens, unrestricted child processes and arbitrary host imports are never exposed.

Filesystem paths are capability handles, not strings. Network access is allowlisted by domain and method. Plugin-provided MCP/LSP servers inherit the host policy and are stopped before a bundle generation is retired.

## 5. Discovery and distribution

- Support project and user sources, local directories, Git revisions and npm/package archives.
- Persist a lockfile with exact version, source revision, integrity hash and transitive dependencies.
- Show changelog, capability changes and permission diff before install/update.
- Validate manifest, signature/integrity, SDK range, platform and dependency graph before code load.
- Keep existing `.claude`, `.agents`, `.opencode` and Apexo skill discovery as compatibility sources, with explicit source/precedence diagnostics.
- Cache packages for offline reinstall but never treat a cache hit as trust approval.

## 6. API/UI and compatibility

Extend [`packages/protocol/src/groups/plugins.ts`](../../../packages/protocol/src/groups/plugins.ts) with manifest, capability, permission-preview, lockfile, conformance, install, upgrade, rollback and runtime-status operations. Server owns source fetch and trust verification; Desktop/CLI display the result and cannot mutate registry files directly.

Provide a typed SDK compatibility matrix for public exports in [`packages/plugin/src/index.ts`](../../../packages/plugin/src/index.ts). A `plugin conformance` command should run schema, lifecycle, permission and failure fixtures against a plugin without enabling it in the user's active project.

## 7. Implementation phases

1. **Manifest:** add schema/version, canonical IDs, integrity and permission declarations; decode legacy plugin metadata into a compatibility manifest.
2. **Resolver:** add source resolver, lockfile, dependency graph and offline cache.
3. **Trust/approval:** produce permission/capability diff and explicit install/enable approval.
4. **Sandbox bridge:** narrow context APIs, credential references, filesystem/network/process enforcement and per-plugin audit events.
5. **Conformance:** template, example plugins, protocol matrix and CI command.
6. **Rollback:** generation snapshots, atomic activation, failed upgrade rollback and retained data policy.

## 8. Test matrix and acceptance criteria

- Invalid manifest, SDK mismatch, unsupported platform, dependency cycle and integrity/signature failure.
- Permission denial for filesystem, network, process and credentials; verify no host escape.
- Install/update/disable/uninstall/reload idempotency and concurrent registry writes.
- Crash during staging/activation; old generation remains usable and new generation is fully retired.
- Lockfile reproduces identical package bytes offline.
- Legacy plugin and skill sources preserve documented precedence.
- CLI/Desktop show permission diff and actionable conformance failures.

Definition of done: a plugin can be developed against a versioned SDK, installed from a reproducible source, reviewed for permissions, activated atomically, audited while running, and rolled back without breaking Session execution.

## 9. Dependencies and risks

- Depends on #183 for credential references and provider capability declarations.
- Depends on #188 for MCP/LSP/skill capability and conformance vocabulary.
- Plugin sandboxing may need a subprocess or Worker boundary on some platforms; document reduced capability instead of silently running unsandboxed.
