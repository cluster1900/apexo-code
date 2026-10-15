# Build metadata in a source-only validation copy

- **ID:** BUG-20261015-140.
- **Status:** Corrected fixture invocation; packaged acceptance is recorded separately.
- **Occurrences:** One authoring episode.
- **Scope:** Private Desktop build of a coherent source copy without Git metadata.

## Observed and expected behavior

Running `bun run build` from the copied `packages/desktop` failed in prebuild before bundling. `packages/script` attempted `git branch --show-current`, which returned exit 128 and `fatal: not a git repository`. The private copy intentionally omitted the shared repository's Git metadata, and the invocation had not supplied the supported explicit build metadata.

## Correction

Run the private build with `APEXO_CHANNEL=beta APEXO_VERSION=1.18.35 bun run build`. These inputs use the existing build contract and avoid Git inference without modifying product code or copying a writable shared Git directory. A separate pre-build file audit also corrected source enumeration to include tracked files in addition to ripgrep's nonignored files; its missing tracked build entrypoint was found before any build was attempted.

## Verification

The corrected private Desktop build passed with exit 0. `bun script/grok-native-shell.mjs desktop` then passed nine checks / 26 provider calls against the rebuilt backend. [The feature document](../../native-shell.md) retains the backend-only acceptance boundary.

## Independent native legacy Memory build invocation

The private legacy Memory build repeated the missing-metadata invocation and failed at `git branch --show-current` before bundling. The corrected invocation set `APEXO_CHANNEL=dev APEXO_VERSION=0.0.0-memory-legacy`; the complete Desktop build passed, followed by four public Memory checks against its rebuilt Electron backend (two main provider calls and one explicit legacy flush). This is a second independent invocation episode. No product change or recurring-rule promotion is warranted.
