# Releasing Apexo

For user installation instructions, see [Install Apexo](installation.md).

A stable `vX.Y.Z` tag on a tested `main` commit runs
[release.yml](../.github/workflows/release.yml). Pull requests that change the
release workflow, packaging scripts, launcher, or Desktop packaging configuration
run the same builds without publishing. The workflow can also be dispatched with
an explicit version for a build without publishing.

## Outputs

- CLI archives for macOS, Linux (glibc and musl), and Windows on x64 and arm64,
  including x64 baseline builds for CPUs without AVX2. Each archive contains both
  `apexo` and the first-party workflow interpreter.
- The `apexo-code` npm launcher and twelve optional platform packages. Their
  versions come from the tag, independently of development workspace versions.
  Consumers need Node.js 22 or newer, without a separate Bun installation.
- Desktop: macOS arm64 DMG/ZIP, Linux x64 AppImage/DEB/RPM, and Windows x64 NSIS.
  CLI support for an architecture does not imply a Desktop installer for it.
- A GitHub Release containing the CLI archives, npm tarballs, Desktop installers,
  an npm package manifest, and SHA256 checksums. Build-only runs retain these as Actions artifacts.

The release job waits for all six native CLI npm installation smoke tests and
all three Desktop packaging jobs. It verifies `--version` through the installed
launcher, including x64 baseline selection, before publishing artifacts.

The current automated Desktop builds use `APEXO_UNSIGNED=1`: macOS receives an
ad-hoc signature without notarization, and Windows receives no publisher
signature. Operating-system trust prompts are expected. Developer ID,
notarization, and Azure signing remain separate configuration work; these
artifacts must not be described as signed, notarized production installers.
CLI Mach-O bundles are ad-hoc signed on the macOS build host after embedding.

## npm setup

`apexo` is already registered by another npm account. This repository defaults to
`apexo-code`, while the installed command remains `apexo`. To change the package
name, set the repository Actions variable `NPM_PACKAGE`; its platform packages
use the same name followed by the platform suffix.

For the first publication, use `npm login` with an account that can publish the
chosen package names. Download the workflow artifacts into `packages/apexo/dist`, or download
`npm-manifest.json` and all thirteen `.tgz` files from the GitHub Release into
`packages/apexo/dist/npm`, renaming `npm-manifest.json` to `manifest.json`.
Publish the exact tested tarballs with:

```bash
bun packages/apexo/script/publish-release.ts
```

The script publishes platform packages first and the launcher last. An existing
version is skipped only when its published integrity matches the prepared
tarball; a conflicting version fails instead of being silently accepted.

For subsequent automatic publishing, configure an npm trusted publisher for
**each of the thirteen packages**, using:

- GitHub owner: `cluster1900`
- Repository: `apexo-code`
- Workflow filename: `release.yml`

The workflow grants `id-token: write` and uses Node.js 24 with a compatible npm
CLI. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
Alternatively, configure the repository Actions secret `NPM_TOKEN` with publish
access to every package. Never commit registry credentials. A missing publishing
credential fails the npm job; the separately verified GitHub Release remains
available for installation and first-publication recovery.

## Publish a version

1. Merge the release changes through a PR after `unit (linux)` and `typecheck`
   pass. Also wait for both checks on the resulting `main` commit.
2. With `gh` authenticated, run `./script/release 1.0.0`. The script fetches
   `origin/main`, checks its CI, and creates and pushes an annotated `v1.0.0`
   tag on that exact commit. It never pushes a branch or moves an existing tag.
3. Watch the release workflow and inspect the resulting Release and npm job.
4. Confirm installation in a fresh shell:

   ```bash
   npm install -g apexo-code@1.0.0
   apexo --version
   ```

If npm fails after publication of the GitHub Release, finish npm setup and rerun
the failed npm job using its retained artifacts, or download those tarballs and
run the publishing script locally. Do not delete or move a published version tag.

The tag workflow independently checks ancestry against `main` and successful
GitHub Actions `unit (linux)` and `typecheck` checks before any release build.

## Recover an upload after a successful build

If a tagged run passed the CLI build, all six CLI installation checks, and all
three Desktop jobs, but failed during GitHub upload, run **recover release** from
Actions using the `main` branch. Supply the existing tag and original release
run ID. For the first release these are `v1.0.0` and `40268896523`.

With an authenticated GitHub CLI, the equivalent is:

```bash
gh workflow run recover-release.yml --ref main -f tag=v1.0.0 -f run_id=40268896523
```

Recovery requires the tag to belong to main, its required CI checks to pass,
and the original tag workflow's ten CLI/Desktop build and installation jobs to
succeed. It publishes those exact retained artifacts with the current upload
helper. It does not rebuild binaries or change the existing tag. Artifacts are
retained for fourteen days. After GitHub publication, first-time npm publishers
can download the attached npm manifest/tarballs and follow the npm setup above.
