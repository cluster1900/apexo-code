<p align="center">
  <img src="docs/assets/apexo-wordmark.png" alt="Apexo" width="420">
</p>
<p align="center"><b>A UI harness for Grok.</b> Open-source coding agent for the terminal, the browser and the desktop.</p>
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

---

## What is Apexo?

Apexo is a UI harness for **Grok**. Its main purpose is to support
[Grok Build](https://github.com/xai-org/grok-build), SpaceXAI's official open-source coding
agent, and to make Grok easier for everyone to use, with a terminal UI, a web UI and a desktop
app on top of the same local agent server.

What you get today:

- **Grok first.** Sign in with your xAI account (SuperGrok, or X Premium where xAI grants
  Grok access) using xAI's OAuth device-code flow. No API key needed. An `XAI_API_KEY` works too.
  All current Grok models from the models.dev catalog are available, for example `grok-4.7`,
  `grok-4.6`, `grok-4.20` and `grok-build-0.1`.
- **Antigravity via native login.** Reuse the local Antigravity CLI (`agy`) login without
  authorizing again. If it is not signed in, complete agy's Google sign-in once.
  See the [Antigravity setup guide](docs/antigravity.md).
- **Secondary providers via API key:** OpenAI, Anthropic (Claude) and Google (Gemini).
- **No paid subscription, no ads.** There is no hosted model gateway, account console,
  session sharing service, upsell or promotional content. Everything runs locally and talks
  directly to the provider you configure.
- **Terminal UI, web UI and desktop app** share one local server and one session history.
- **Grove theme**: a warm-dark/green default theme for both the TUI and the app. All of the
  classic themes are still available.

### OAuth scope and why

This project's OAuth integration is limited to **Antigravity and Grok**, and to **local use**.
Authentication is handled on your own machine; there is no hosted OAuth relay or account service.
Model requests still go directly to the respective provider. This scope concerns OAuth and login
session integration; the API-key connections listed below remain available.

**A note from the maintainer:** I choose Antigravity and Grok because I see them as welcoming
Chinese users rather than excluding people simply for being Chinese. That matters to me.
I oppose nationality-based exclusion and consider Claude's restrictions on Chinese users
discriminatory, so I do not plan to integrate Claude OAuth.

OpenAI OAuth is outside the scope for a different reason: I think OpenAI's own tools are already
so good that I do not believe I can surpass their experience. I would rather focus this project
on Antigravity and Grok.

> [!NOTE]
> **Status of the Grok Build integration.** Enable the Grok Build profile with
> `apexo run --profile grok-build`, or set `APEXO_RUNTIME_PROFILE=grok-build` when launching Desktop.
> It runs Apexo's own agent loop against the xAI API and exposes a canonical Grok Build tool contract.
> See the [feature and regression report](docs/grok-build-feature-gap.md) for verified capabilities and remaining gaps. For clients that need the
> official runtime, `apexo acp --backend grok-build` transparently connects to `grok agent stdio`;
> the existing Apexo ACP backend remains the default. Desktop/App backend selection and full
> Session/event mapping are still being expanded.

<p align="center">
  <img src="docs/assets/apexo-tui.png" alt="Apexo terminal UI" width="820">
</p>
<p align="center">
  <img src="docs/assets/apexo-web.png" alt="Apexo web UI" width="820">
</p>

## Install (build from source)

Apexo is not published to package managers yet. To build it you need
[Bun](https://bun.sh) 1.3.x (the repo pins `bun@1.3.14`) and git.

```bash
git clone https://github.com/cluster1900/apexo-grok.git apexo && cd apexo
bun install

# Build a single native binary for this machine (the web UI is embedded)
bun run --cwd packages/apexo build --single

# The binary lands in packages/apexo/dist/apexo-<os>-<arch>/bin/apexo
install -D -m755 packages/apexo/dist/apexo-*/bin/apexo ~/.local/bin/apexo
apexo --version
```

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds every target and
attaches the archives to a [GitHub Release](https://github.com/cluster1900/apexo-grok/releases).
Once a release exists, the install script can fetch it instead (`--version X.Y.Z` pins a release):

```bash
curl -fsSL https://raw.githubusercontent.com/cluster1900/apexo-grok/main/install | bash
```

To run from source without building:

```bash
bun dev            # same as: bun run --cwd packages/apexo src/index.ts
bun dev --help
```

## Usage

```bash
apexo                     # start the terminal UI in the current directory
apexo auth login          # sign in: pick xAI -> "SuperGrok Subscription" (OAuth) or an API key
apexo auth list           # show configured credentials
apexo models xai          # list Grok models
apexo run "explain this repo"   # one-shot, non-interactive
apexo web                 # start the local server and open the web UI
apexo serve               # headless server (for the desktop app, editors, scripts)
apexo acp                 # run Apexo as an ACP agent for editors such as Zed
```

In the TUI, `/connect` opens the provider dialog, `/models` switches models, `/themes` switches
themes, and `ctrl+p` opens the command palette. Start a prompt with `!` to run a shell command.

### Providers

| Provider               | How to connect                                                                            | Environment variable           |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| **xAI Grok** (primary) | `apexo auth login`, then xAI -> SuperGrok Subscription (device-code OAuth), or an API key | `XAI_API_KEY`                  |
| **Antigravity**        | Select Antigravity; reuse the local `agy` login, or complete agy's Google sign-in once    | —                              |
| OpenAI                 | API key                                                                                   | `OPENAI_API_KEY`               |
| Anthropic (Claude)     | API key                                                                                   | `ANTHROPIC_API_KEY`            |
| Google (Gemini)        | API key                                                                                   | `GOOGLE_GENERATIVE_AI_API_KEY` |

A generic OpenAI-compatible "custom provider" entry is still available for self-hosted endpoints.

### Desktop app

The Electron desktop app lives in `packages/desktop`:

```bash
bun run --cwd packages/desktop dev        # development build
bun run --cwd packages/desktop build      # production bundle (packaging uses electron-builder)
```

The desktop app has no auto-updater; rebuild it (or install a newer release) to update.

## Configuration

Apexo reads JSON/JSONC config files:

| What                  | Location                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| Global config         | `~/.config/apexo/apexo.jsonc` (`apexo.json` also works)                   |
| Data / state / cache  | `~/.local/share/apexo`, `~/.local/state/apexo`, `~/.cache/apexo`          |
| Project config        | `apexo.json` / `apexo.jsonc` in the project (searched up to the git root) |
| Project directory     | `.apexo/` (agents, commands, plugins, themes, tools)                      |
| Environment variables | `APEXO_*` (for example `APEXO_CONFIG`, `APEXO_CONFIG_CONTENT`)            |

Example `apexo.json`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/cluster1900/apexo-grok/main/schemas/config.json",
  "model": "xai/grok-4.7",
  "theme": "grove",
}
```

JSON schemas for editor completion live in [`schemas/`](schemas): `config.json` (apexo.json),
`tui.json`, `theme.json` (TUI themes) and `desktop-theme.json` (app themes). Regenerate them with
`bun script/schemas.ts`.

Files, directories and environment variables from an existing install of the upstream project
are still read as fallbacks (Apexo names win), so earlier setups keep working. The compatibility
names are kept in one place: [`packages/core/src/legacy-compat.ts`](packages/core/src/legacy-compat.ts).

## Themes

- **TUI:** `grove` is the default. Switch with `/themes`, or set `"theme"` in `tui.json`
  (`~/.config/apexo/tui.json`). Custom themes go in `.apexo/themes/*.json` or
  `~/.config/apexo/themes/`.
- **Web and desktop app:** Grove is the default in Settings -> Appearance. The original theme is
  listed as "Classic".

## Development

```bash
bun install
bun turbo typecheck --concurrency=1
(cd packages/core && bun test)
(cd packages/apexo && bun test)
(cd packages/tui && bun test)
```

Workspace packages use the `@apexo/*` scope; the CLI and server live in
`packages/apexo`.

## Feedback

Report bugs and ideas at [github.com/cluster1900/apexo-grok/issues](https://github.com/cluster1900/apexo-grok/issues).

## License

MIT. See [LICENSE](LICENSE). The original copyright notice is kept intact.

---

Apexo is built on [OpenCode](https://github.com/anomalyco/opencode). Thanks to the OpenCode authors and contributors.
