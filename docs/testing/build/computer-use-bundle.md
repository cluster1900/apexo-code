# Computer Use bundle assembly

## BUG-20261116-001: Hash input rejected by Bun's Node crypto compatibility

- Scope: the standalone Computer Use bundle builder, Bun 1.4.4 on macOS arm64.
- Observed: assembling the downloaded pinned archive failed before extraction with `ERR_INVALID_ARG_TYPE`; `Hash.update` rejected an `ArrayBuffer`.
- Expected: verify archive/file SHA-256 values and publish an installable bundle.
- Reproduction: run `bun script/build.mjs --archive <verified-release.tar.gz>` from `plugins/computer-use` using the initial builder implementation.
- Root cause: the Node crypto API accepts byte arrays, not the `ArrayBuffer` returned by `Bun.file(...).arrayBuffer()` in this runtime.
- Fix: use `Bun.file(...).bytes()` for both archive and assembled-file hashes.
- Verification: offline assembly and the builder's own download path both succeeded with the pinned arm64 archive SHA-256 `9b7b7cfc74892eab46c2c85d6cb7dc4863bf8dab0a222cfcfb8ae4604c69c86c`. The corrupt-archive test rejects publication. The four plugin tests passed with 68 assertions. Real installed-bundle CLI and Electron-backend scenarios also completed successfully.
