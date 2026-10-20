# Apexo CLI and server (`packages/apexo`)

This package builds the `apexo` command: the terminal UI, the local HTTP server used by the
web and desktop apps, `apexo run`, `apexo acp`, and the other subcommands.

```bash
bun install
bun run src/index.ts --help          # run from source (same as `bun dev` at the repo root)
bun run build --single               # build dist/apexo-<os>-<arch>/bin/apexo
bun test                             # tests (run from this directory, not the repo root)
```

See the [root README](../../README.md) for supported providers (Google Gemini, Antigravity, xAI Grok, OpenAI, Anthropic, and custom OpenAI-compatible endpoints), configuration (`apexo.jsonc`, `.apexo/`, `APEXO_*`), and themes.
