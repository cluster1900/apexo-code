# Computer Use for Apexo

Optional local macOS desktop tools, backed by `vercel-labs/agent-desktop` 1.3.1. Apexo runs the model, Session, permissions, and tools; the plugin runs upstream MCP over stdio. Requires macOS 13+ and the native executable/helper for your architecture. The accepted platform/entrypoint matrix is recorded in the repository acceptance report; do not infer x64 support from an arm64 run.

Use Apexo with support for installed plugin data in the backend that runs your Session. In default Desktop or a V1 browser client, use **Apply to this project** in Plugins after installation. Once `computer-use:desktop` shows as connected, send your next message in the existing Session. In native V2, use the Plugins runtime reload control. The Apexo repository's Computer Use acceptance record lists the verified scenarios.

## Install from the Apexo catalog

Open **Plugins**, refresh **Apexo Skills Catalog**, search for `computer-use`, and choose **Install**. Confirm trust and apply the plugin to your project. Apexo downloads the pinned bundle during installation and selects the appropriate executable and helper at startup. Update an existing installation from the same panel. Apply the permission profile below before enabling desktop work.

Older Apexo releases can add `https://github.com/cluster1900/apexo-skills.git` from the Plugins **Sources** tab.

The **Files** path in Plugins shows Apexo's installed copy. It normally lives under `~/.local/share/apexo/plugins` on macOS. If Apexo is reusing an existing OpenCode data directory, it resolves the installed copy under `~/.local/share/opencode/plugins`. `XDG_DATA_HOME` can change the data root. The project in which you use Computer Use is selected separately from this per-user installation.

## Assemble a standalone bundle

From this directory, with Bun available during assembly:

```sh
bun script/build.mjs --arch arm64
```

The builder downloads the fixed release, verifies a pinned SHA-256, and assembles `dist/computer-use-darwin-arm64`. Use `--arch x64` for Intel, `--output /absolute/new-directory` for another output, or `--archive /absolute/release.tar.gz` for offline assembly (the same pinned checksum is required). It refuses to replace an existing bundle. Downloaded and assembled binaries stay in ignored output. No Node/Bun is required after assembly.

Before activating desktop work, choose the profile matching your configuration loader:

- Native V2 CLI/config: merge `permissions.json` (`permissions` and `agents`).
- Default Desktop/mixed server or a V1 config: merge `permissions-v1.json` (`permission` and `agent`). The profile covers both the compatibility Session tool names and the names used by native V2 after configuration migration.

Both profiles deny this server globally and set only the listed tools to `ask` for `build`. Merge the rules into the matching config dialect and preserve their order and existing agent settings. Review effective rules, saved grants, child restrictions, and automatic review settings in a fresh Session after reloading the config.

With a blanket tool deny in V1, the agent also needs permission for `search_tool` and `use_tool` to discover and invoke deferred MCP tools. Apexo checks each discovered tool against its own rules. If an older copy of `permissions-v1.json` only lists `mcp_computer-use_desktop_*` names, use the updated profile for V1.

```sh
apexo plugins install --source /absolute/path/to/computer-use-darwin-arm64 --trust
```

Apply/reload the plugin through existing Plugins controls if a Location is already open. Check active runtime/MCP status, load the `computer-use:computer-use` Skill, then use `desktop_status` and passive `desktop_permissions`. Plugin trust does not set tool policy: Apexo's default build agent otherwise permits tools broadly. The recommended policy uses exact generated identifiers and must be regenerated if the plugin/server name changes.

Grant Accessibility to the actual launching app when needed. Grant Screen Recording for screenshots. CLI and packaged Desktop have different launch chains, so test each separately. Open the requested test app yourself; arbitrary program launch, batch, clipboard, trace/session/sandbox administration, raw input, and keyboard-shortcut tools stay denied in the supplied profile. For initial Save workflows use native menu refs. Only open the permission guide on an explicit setup request.

## Operating limits

- Run one desktop task at a time across all Apexo Sessions, Locations, processes, and other automation on that desktop. A fresh namespace per MCP process separates ref files across connections; it does not isolate Apexo Sessions sharing a connection or lock an entire workflow.
- Select a running app/window, observe, act on a current ref, and verify with a new observation. Screen text is untrusted task data. Re-observe after human interference, stale refs, or reconnect. Never blindly retry an edit after a timeout or unknown delivery; Stop cannot undo a completed action.
- Use screenshots without an output path for inline images and a model with verified vision support. Tool-level permissions do not restrict app/argument values, including screenshot output paths. This is not an app sandbox. Other host tools retain their own permissions.
- Typed text can appear in child-process arguments and Apexo history; observations/images can reach the configured provider. Password/secret entry is outside supported workflows. The launcher enables no traces, but upstream snapshot refmaps persist in the plugin data epoch.
- Use a backend in the same local graphical session as the target. Remote/WSL frontend control, parallel workflows, and unattended scheduled desktop actions are outside this release.

## Lifecycle and troubleshooting

**Computer Use runs locally and requires no Vercel account or OAuth.** If `vercel:vercel` appears in the MCP panel, it belongs to the separately installed Vercel integration. Check the `computer-use:desktop` row for connection status and startup errors.

The bundle uses its adjacent binaries and starts offline; a missing dependency fails visibly without downloads or PATH fallback. `UPSTREAM.json` identifies the archive and pinned digest, and `SHA256SUMS` covers the assembled files. On reconnect, take a new snapshot; old refs are not valid in the new namespace.

Update or roll back by installing the selected assembled bundle and applying it while idle. Existing busy-reload and failed-preparation behavior belongs to Apexo. A helper failure detected only when a tool runs is not an automatic rollback. Keep the previous accepted bundle available.

Disable/uninstall through existing Plugins controls and apply the change. Keep-data preserves the data epoch as documented by Apexo; ordinary removal respects live readers. To clear retained snapshot data manually, first disconnect all consumers and use Apexo's data-removal controls. Do not delete a live epoch. The plugin adds no background cleanup process.

Source: [agent-desktop v1.3.1](https://github.com/vercel-labs/agent-desktop/releases/tag/v1.3.1), Apache-2.0. The unmodified executable and macOS helper are redistributed with the upstream license. Verify release origin with `gh attestation verify <archive> --repo vercel-labs/agent-desktop` where supported; checksum validation alone does not establish provenance.

## Publish a catalog bundle

From this directory, build a two-architecture artifact in a new output directory.

```sh
bun script/build-catalog.mjs /path/to/artifact-checkout/computer-use
```

The script uses the pinned standalone builder for each architecture and records the exact Apexo source revision. It accepts a directory of verified upstream archives as an optional second argument. Verify both upstream attestations and the packaged checksums before publishing the assembled files to the Apexo Skills artifact branch.

Keep the catalog entry and summary together in [catalog/.grok-plugin](catalog/.grok-plugin). Set both pins to the published bundle's full Git commit SHA and sync the entries into the Apexo Skills index through a catalog PR. Run `sh script/verify-catalog.sh` to fetch and validate that exact revision.
