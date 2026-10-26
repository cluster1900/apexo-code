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
- Registry account authentication was verified before first publication. Local
  tarball installation and actual registry publication are separate checks.

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
  spawn diagnostic reports `true true`. The actual publication command also
  reached npm's web/2FA challenge and accepted terminal input to open the browser.
  This verifies the interactive boundary; the account holder completes the
  browser security/passkey step and registry publication is checked separately.

## BUG-20261026-RELEASE-LAYOUT: Pattern download adds an unexpected directory

- **Scope:** Final GitHub Release upload, after successful tagged builds.
- **Observed:** Tag run 40268896523 passed all eight interpreter builds, all twelve
  CLI compilations, all six native installation checks, and all three Desktop
  packaging jobs. Its publisher then failed to find `artifacts/cli/npm/manifest.json`.
- **Expected:** A single CLI artifact extracts directly into the publisher's CLI
  directory, and verified assets are uploaded without rebuilding or moving tags.
- **Reproduction:** Download the single `cli-release` artifact using `pattern`
  without `merge-multiple: true`. download-artifact extracts it under an extra
  `cli-release/` directory. This is the exact directory reported in job
  121400678980's download log.
- **Root cause:** The publisher used multi-artifact pattern selection for one
  named artifact, while its filesystem paths assumed the single-name layout.
- **Fix:** Select the CLI artifact with `name`. Share release preparation/upload
  in `script/publish-artifacts`, and exercise its metadata/checksum preparation
  against real downloaded CLI artifacts in Linux installation CI. Add a manual
  recovery workflow that verifies the original tag, successful main CI, original
  run identity, and all ten build/install jobs before reusing saved artifacts.
  The existing `v1.0.0` tag and its source commit remain unchanged.
- **Verification:** The original publisher failed before creating a Release.
  Shell syntax and actionlint validation pass for the correction. The real
  recovery upload passed in
  [run 40272132287](https://github.com/cluster1900/apexo-code/actions/runs/40272132287).
  The published GitHub Release contains all 33 uploaded assets. The Linux
  preparation regression also passed in job 121407218832 of
  [run 40271527106](https://github.com/cluster1900/apexo-code/actions/runs/40271527106).

## Public download verification

- [v1.0.0](https://github.com/cluster1900/apexo-code/releases/tag/v1.0.0) is public
  and non-draft, with twelve CLI archives, thirteen npm tarballs, six Desktop
  installer files, the npm manifest, and SHA256SUMS. The two GitHub-generated
  source archives appear separately in the web interface.
- Downloading the public macOS arm64 CLI archive and SHA256SUMS, verifying its
  SHA256 with `Bun.CryptoHasher`, extracting it with `unzip -q`, and running
  `apexo --version` passed with output `1.0.0`. The adjacent first-party workflow
  interpreter is present.
- All thirteen public npm tarballs were downloaded and verified against the
  original pack manifest's SHA512 integrity before first registry publication.
- The recovered upload retained tag `v1.0.0` at commit
  `367d8f1dda7c166c6147fae102c0bdfd0d026a1b`.

## BUG-20261026-RELEASE-NPM-RATE: Partial first publication hits registry throttling

- **Scope:** First npm publication of the thirteen verified `1.0.0` tarballs.
- **Observed:** npm accepted ten platform packages after interactive web
  authentication. The registry initially exposed processing placeholders; all ten
  subsequently became publicly available at `1.0.0` with the original manifest's
  SHA512 integrity and the `latest` tag. Publishing the eleventh package,
  `apexo-code-windows-x64-baseline`, failed twice: the authenticated PUT returned
  429, then its retry returned 401 and the CLI reported `EOTP`, despite the web
  authentication page displaying success. This occurred with npm 11.12.1 and
  11.21.1. A staged-upload recovery attempt also returned `E429`.
- **Expected:** All twelve platform packages become available before the CLI
  launcher is announced as installable from npm.
- **Reproduction:** Publish the original first-release manifest in order, using
  inherited terminal streams and completing the prompted browser authentication.
  The remaining Windows x64 packages and launcher were not accepted in these
  attempts.
- **Root cause:** The registry explicitly rejected publication with a rate-limit
  response. Its quota, reset time, and the reason the subsequent authenticated
  retry returned 401 are unknown. A successful browser challenge does not prove
  successful package publication; the client upgrade and staged-upload attempt
  did not resolve the throttling.
- **Recovery:** Retain the original tarballs and tag, stop immediate retries,
  allow a cooldown, and resume only unpublished packages. Keep the public Release's
  npm-pending notice until registry metadata and a fresh installation succeed.
- **Verification:** Ten public versions and their integrity match the original
  manifest. The remaining three packages and a fresh registry installation are
  pending; no complete npm release or rate-limit fix is claimed.
- **Occurrences:** One first-publication episode. Its direct retries and staged
  attempt are not separate historical occurrences.
