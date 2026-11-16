# Computer Use for Apexo

Optional local macOS desktop tools, backed by `vercel-labs/agent-desktop` 1.3.1. Apexo runs the model, Session, permissions, and tools; the plugin runs upstream MCP over stdio. Requires macOS 13+ and the native executable/helper for your architecture. The accepted platform/entrypoint matrix is recorded in the repository acceptance report; do not infer x64 support from an arm64 run.

Use native V2 Sessions. The browser client must connect to the native V2 server. Desktop's native window acceptance uses the existing V2 sidecar (`APEXO_SIDECAR_V2=1`); the default mixed sidecar advertises V1 to the frontend and does not expose native plugin activation there. To assemble the tested Desktop variant, run `APEXO_SIDECAR_V2=1 bun run build` then `APEXO_UNSIGNED=1 bun run package --mac --dir` from `packages/desktop`, and launch it with `APEXO_SIDECAR_V2=1`. Alternatively connect Desktop to a local native V2 server through its existing server settings. A V1 config profile below describes config syntax; it does not certify V1 Session execution. The minimum reviewed host baseline is Apexo 1.18.35 at `d2ca7f0c6f65fd343bb5c7301cc79d85ae4626b1`; the two generic host corrections recorded in the implementation report are also required for the tested V2 Desktop/xAI combination.

## Build and install

From this directory, with Bun available during assembly:

```sh
bun script/build.mjs --arch arm64
```

The builder downloads the fixed release, verifies a pinned SHA-256, and assembles `dist/computer-use-darwin-arm64`. Use `--arch x64` for Intel, `--output /absolute/new-directory` for another output, or `--archive /absolute/release.tar.gz` for offline assembly (the same pinned checksum is required). It refuses to replace an existing bundle. Downloaded and assembled binaries stay in ignored output. No Node/Bun is required after assembly.

Before activating desktop work, choose the profile matching your configuration loader:

- Native V2 CLI/config: merge `permissions.json` (`permissions` and `agents`).
- Default Desktop/mixed server or a V1 config: merge `permissions-v1.json` (`permission` and `agent`). The default compatibility config loader explicitly rejects V2 permission fields. Apexo's native Session runtime migrates this V1 profile into the same native rules.

Both profiles deny this server globally and set only the listed tools to `ask` for `build`. Merge ordered rules and existing agent settings, preserving unrelated configuration; do not blindly replace your config or mix dialects. Review effective rules, saved grants, child restrictions, and automatic review settings in a fresh Session. Host config changes require a new Location/backend; Apply Plugins alone does not rediscover config files.

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

The bundle uses its adjacent binaries and starts offline; a missing dependency fails visibly without downloads or PATH fallback. `UPSTREAM.json` identifies the archive and pinned digest, and `SHA256SUMS` covers the assembled files. On reconnect, take a new snapshot; old refs are not valid in the new namespace.

Update or roll back by installing the selected assembled bundle and applying it while idle. Existing busy-reload and failed-preparation behavior belongs to Apexo. A helper failure detected only when a tool runs is not an automatic rollback. Keep the previous accepted bundle available.

Disable/uninstall through existing Plugins controls and apply the change. Keep-data preserves the data epoch as documented by Apexo; ordinary removal respects live readers. To clear retained snapshot data manually, first disconnect all consumers and use Apexo's data-removal controls. Do not delete a live epoch. The plugin adds no background cleanup process.

Source: [agent-desktop v1.3.1](https://github.com/vercel-labs/agent-desktop/releases/tag/v1.3.1), Apache-2.0. The unmodified executable and macOS helper are redistributed with the upstream license. Verify release origin with `gh attestation verify <archive> --repo vercel-labs/agent-desktop` where supported; checksum validation alone does not establish provenance.
