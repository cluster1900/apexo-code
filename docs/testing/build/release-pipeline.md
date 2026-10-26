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
- The first PR release build produced all twelve CLI targets and passed all six
  native npm installation checks (Linux, macOS, Windows; x64 and arm64). The
  Windows Desktop installer also passed. See
  [run 40264955859](https://github.com/cluster1900/apexo-code/actions/runs/40264955859).
  Linux/macOS Desktop corrections are recorded below.
- Registry publication is pending. Registry authentication has been verified;
  successful local installation is not a claim that the package is published.

## BUG-20261025-RELEASE-LINUX: Missing Linux package maintainer

- **Scope:** Desktop DEB/RPM packaging in the release workflow.
- **Observed:** The first PR build produced an AppImage, then DEB packaging failed
  with `Please specify author 'email' in the application package.json`.
- **Expected:** All configured Linux installer formats build in CI.
- **Reproduction:** Run the Linux Desktop package job from PR #166's first release
  workflow run, or package the same configuration on Linux.
- **Root cause:** The application author had no email and Linux packaging had no
  explicit maintainer. electron-builder requires one of those metadata sources.
- **Fix:** Configure the repository owner's GitHub noreply identity as the Linux
  maintainer. Install RPM tooling explicitly instead of assuming runner contents.
  Correct the user guide to the target-specific `x86_64`/`amd64` installer names.
- **Verification:** The original failure is recorded in release run
  [40264955859](https://github.com/cluster1900/apexo-code/actions/runs/40264955859),
  job 121386270206. Configuration typing passed. The corrected Linux job
  121392368210 in [run 40267132456](https://github.com/cluster1900/apexo-code/actions/runs/40267132456)
  passed and uploaded AppImage, DEB, and RPM installers. The generated filenames
  match the installation guide.

## BUG-20261025-RELEASE-HEAP: macOS runner exhausts the renderer build heap

- **Scope:** The macOS Desktop renderer build on the hosted arm64 runner.
- **Observed:** After transforming the renderer modules, Node aborted with
  `Ineffective mark-compacts near heap limit` at approximately 2 GiB. The same
  source builds on the local machine with its larger default heap.
- **Expected:** The hosted runner completes the renderer and installer builds.
- **Reproduction:** Run the original macOS Desktop release job on `macos-15`
  without an explicit Node heap budget.
- **Root cause:** Node's automatic heap limit on the hosted runner is smaller than
  this renderer build's working set; the fatal V8 allocation report identifies
  the exhausted heap rather than a source or signing failure.
- **Fix:** Set `NODE_OPTIONS=--max-old-space-size=6144` for Desktop CI builds.
- **Verification:** The original failure is recorded in release run
  [40264955859](https://github.com/cluster1900/apexo-code/actions/runs/40264955859),
  job 121386270252. With the explicit heap budget, macOS job 121392368188
  in [run 40267132456](https://github.com/cluster1900/apexo-code/actions/runs/40267132456)
  completed the renderer build and uploaded the DMG and ZIP successfully.

## BUG-20261025-RELEASE-TTY: Preserve interactive npm authentication

- **Scope:** First publication from an authenticated local terminal.
- **Observed:** A real terminal diagnostic using Bun shell reports the npm-style
  child's stdout as non-TTY. npm's authentication implementation only opens a
  web/2FA retry when both input and output are terminals.
- **Expected:** A first publisher can complete the registry's authentication
  challenge from the release script.
- **Reproduction:** In a terminal, run a Node TTY diagnostic through Bun shell;
  compare it with `Bun.spawn` using inherited input, output, and error streams.
- **Root cause:** Bun shell captures child output, which removes npm's terminal
  detection despite the parent process running in a real terminal.
- **Fix:** Spawn `npm publish` with all three standard streams inherited and
  propagate a failed child exit. CI OIDC publication remains noninteractive.
- **Verification:** The shell diagnostic reported `true undefined`; the inherited
  spawn diagnostic reports `true true`. The real first-publication challenge is
  still pending and is not claimed as verified by this diagnostic alone.
