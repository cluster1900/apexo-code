---
name: apexo-plugin-authoring
description: Use when creating or changing Apexo plugins, custom tools, plugin servers, TUI extensions, themes, or the future Grok Package manifest.
---

# Plugin and Grok Package authoring

Inspect `packages/apexo/src/plugin`, the current installer, tool registry, and the nearest package instructions before adding an extension.

## Current extension points

- Begin with one existing extension point and one resource type. Do not build the future Grok Package manager, lifecycle framework, or unified resource catalog for a single plugin need.
- Respect the existing plugin entrypoints for server/TUI exports, themes, and custom tools.
- Plugin packages already use `package.json`, file/npm installation, `engines.apexo`, `exports["./server"]`, `exports["./tui"]`, server/TUI entrypoints, and `oc-themes`. Do not introduce a parallel manifest without an explicit migration design.
- The current installer turns server, TUI, `main`, `oc-themes`, and the first `apexo.skills` resource into install targets. `apexo.skills` uses relative directories (for example `skills`) and maps into the existing V1 `skills.paths` loader. V2 manifest integration and other resource types remain separate slices.
- Configured `{tool,tools}/*.{js,ts}` modules are dynamically imported by `packages/apexo/src/tool/registry.ts` during registry initialization. Treat that import behavior as current compatibility surface; changing import-time side effects needs a separate lifecycle migration.
- Keep plugin discovery, validation, permission checks, and runtime registration explicit.
- A plugin tuple may set `{ "trust": "deny" }` in its existing options object. The server and TUI skip that plugin before resolution/import; omitted or unknown values preserve current compatibility loading. This is the first executable registration gate, not a complete provenance system.
- Custom tools must declare stable input/output schemas, honor cancellation and permissions, and redact sensitive results.
- Future plugin load should be reversible with explicit lifecycle/dispose hooks for processes, sockets, watchers, and MCP clients. Current registry/plugin imports may run module initialization, so document and migrate that behavior before enforcing a no-side-effect rule.
- Do not change generated client code directly. Public Protocol/Server changes use `apexo-httpapi-contract`.

## Future Grok Package

Use the package.json extension discussed in `docs/grok-agent-expansion.md` to eventually package skills, commands, tools, MCP declarations, themes, and provider adapters. This is an extension of the current plugin package, not a new standalone JSON; preserve `exports`, `oc-themes`, and existing install behavior. A package declares resources and requested capabilities; it does not take over Session V2 orchestration. Source, version, digest, and trust fields are deferred until a concrete provenance/trust caller and policy are selected; do not add them to the first single-resource slice speculatively.
