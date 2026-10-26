# BUG-20261025-RELEASE: Release entrypoint and install distribution drift

- **Scope:** `script/release`, the tag release workflow, the installed CLI launcher,
  npm manifests, and release installation URLs.
- **Observed:** `script/release` dispatched `publish.yml`, which is absent. The
  existing tag workflow produced only CLI GitHub archives, without npm publishing
  or Desktop installers. Installation documentation and the shell installer still
  requested releases from `cluster1900/apexo-grok`, while this repository is
  `cluster1900/apexo-code`. The development CLI manifest is private and contains
  workspace/catalog dependencies, so it cannot serve directly as an installable
  standalone npm distribution.
- **Expected:** A version tag on tested `main` produces consistent CLI, npm, and
  Desktop artifacts. A normal npm installation provides the `apexo` command
  without workspace dependencies or a separate Bun installation.
- **Reproduction:** Inspect the workflow dispatched by `script/release` against
  `.github/workflows`; inspect the tag workflow jobs and installer release URLs.
  The npm registry also shows `apexo` belongs to another maintainer, so this
  repository uses the available `apexo-code` name rather than assuming ownership.
- **Root cause:** The legacy release entrypoint, source package manifests, and
  distribution repository were never reconciled with the current repository and
  Desktop build. This is one identified release integration episode, without a
  recurring-rule claim.
- **Fix:** Create annotated tags on checked `origin/main`; validate main ancestry
  and required CI in the tag workflow; generate dedicated versioned npm manifests
  with optional platform binaries; derive the launcher's binary package prefix
  from its installed manifest; install and exercise packed tarballs on six native
  runners; package Desktop on three native runners; upload checksums and artifacts;
  publish platform packages before the launcher. The installer now uses this
  repository, retains the workflow interpreter beside the CLI, and supports
  Windows arm64 archives with executable extensions. Explicit unsigned Desktop builds use ad-hoc macOS signing and skip
  notarization; obsolete resources from the absent Desktop `native/` directory
  are removed from packaging configuration.

## Verification

All local verification uses the repository-pinned Bun 1.4.4.

- `actionlint .github/workflows/release.yml`: passed.
- `bash -n script/release install`: passed.
- `node --check packages/apexo/script/smoke-release.mjs`: passed.
- From `packages/apexo`, `APEXO_VERSION=1.0.0 APEXO_CHANNEL=latest bun run build
--single --skip-install`: passed with the embedded Web UI; the actual compiled
  macOS arm64 CLI reports `1.0.0`.
- From `packages/apexo`, `APEXO_VERSION=1.0.0 APEXO_CHANNEL=latest bun
script/package-release.ts --single`, then `node script/smoke-release.mjs`:
  passed. npm installed the two real packed tarballs into a fresh directory and
  the installed launcher reports `1.0.0`.
- `GITHUB_ACTIONS=false bun turbo test --concurrency=2`: passed all six tasks,
  including all seventeen Apexo batches.
- From `packages/desktop`, `APEXO_VERSION=1.0.0 APEXO_CHANNEL=prod
APEXO_UNSIGNED=1 bun scripts/prepare.ts`, followed by `bun run build` and
  `bun run package:mac --publish never` with the same environment: passed;
  produced the macOS arm64 DMG and ZIP with bundle version `1.0.0`.
- `codesign --verify --deep --strict` on the packaged application: passed.
  Running its Electron executable in Node mode also opened an in-memory SQLite
  database and executed a query successfully.
- The publishing script rejects an incomplete native-only manifest before
  contacting the registry, and the tag script rejects an invalid version.
- `bun turbo typecheck --concurrency=2`: passed all 21 tasks after the final
  source changes and generated-code checks.
- `bun run check:generated` from `packages/client` and `packages/sdk/js`: passed.
- `bun run test:httpapi` from `packages/apexo`: coverage, auth, and effect each
  passed 346 scenarios with zero failures, skips, or missing routes.
- Cross-platform CI and registry publication are pending. Registry authentication
  has been verified; successful local installation is not a claim that the
  package is published.
