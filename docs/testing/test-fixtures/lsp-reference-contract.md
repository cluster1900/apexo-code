# BUG-20261014-272: Installed-reference fixture omitted the LSP gate and absolute-path contract

- Scope: Isolated installed Grok Build 1.0.52 comparison only.
- Observed: Initially the provider did not advertise an LSP tool. After enabling its feature gate, the first call returned `invalid file path`.
- Expected: Configure the installed runtime according to its actual feature registry and advertised input schema before comparing execution.
- Root causes: The reference's `LspTools` feature defaults off and uses `GROK_LSP_TOOLS`; its `file_path` requires an absolute path and its positions are 0-based. The initial fixture assumed default advertisement and supplied a project-relative path.
- Fix: Explicitly set `GROK_LSP_TOOLS=1`, inspect the advertised `lsp` schema, supply an absolute fixture path and 0-based positions, and reuse the isolated Session across six operations so its opened document is available to workspace-symbol lookup.
- Verification: `bun script/grok-lsp-official.mjs` passed all six operations against real clangd with 13 provider requests including the ancillary title request. The private runtime, home, provider server, and owned processes were closed. Apexo retains its own relative-or-absolute `filePath` and 1-based tool contract; no official runtime is embedded.
- These are separate fixture setup/input mistakes, not evidence that product LSP was unavailable, and not multiple occurrences of a recurring product defect.
