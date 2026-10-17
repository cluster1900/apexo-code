# BUG-20261017-388 — Phase 4 Media Policy Completion, Local Session Trace Bundle CLI, and Cross-Platform Acceptance Audit

- **Bug ID**: `BUG-20261017-388`
- **Affected Scope**:
  - `packages/core/src/config/media.ts`
  - `packages/core/src/config/grok-media.ts`
  - `packages/core/src/tool/media-s3.ts`
  - `packages/core/src/tool/media.ts`
  - `packages/apexo/src/tool/grok-build-media.ts`
  - `packages/apexo/src/tool/registry.ts`
  - `packages/apexo/src/cli/cmd/trace.ts`
  - `packages/apexo/src/index.ts`
- **Category**: Runtime / Security Boundary / Media Policy & Trace CLI (`R10`, `R11`, `R12`)

## Observed and Expected Behavior

1. **Zero Data Retention (ZDR) video policy enforcement and `zdr_only` S3 gating (`R10`)**:
   - **Observed**: Neither native `ConfigMedia.resolve` nor compatibility `GrokBuildMedia` evaluated supported team ZDR claims (`BLOCKED_REASON_NO_LOGS`, `BLOCKED_REASON_NO_LOGS_MODERATED`, `disable_zdr_incompatible_tools`, `GROK_DISABLE_ZDR_INCOMPATIBLE_TOOLS`, `GROK_TEAM_BLOCKED_REASONS`). Video generation (`image_to_video` and `reference_to_video`) could proceed against provider-default video storage when ZDR was active without S3 storage configured, and `zdr_only: true` S3 configurations had no activation gate.
   - **Expected**: Only supported ZDR claims activate ZDR policy (unrelated `team_blocked_reasons` are ignored). When ZDR is active, `image_to_video` and `reference_to_video` fail closed before outbound work unless S3 video output is active (`"Team Zero Data Retention (ZDR) policy requires S3 video output storage for video generation"`), and `zdr_only: true` S3 output activates only when ZDR is active.

2. **Deferred completion-time S3 `GET` presigning and Effect v4 compatibility (`R10`)**:
   - **Observed**: Native `MediaTools` (`packages/core/src/tool/media.ts`) and compatibility `GrokBuildMedia` (`packages/apexo/src/tool/grok-build-media.ts`) minted both `PUT` and `GET` presigned URLs together before `POST /videos/generations` rather than minting the `GET` download URL fresh when video generation completed. In addition, using `Effect.either` in `grok-build-media.ts` threw `TypeError: args[0] is not a function` under Effect v4 (`4.0.0-beta.83`) where `Effect.either` is not exported.
   - **Expected**: Capture the resolved reader/writer credentials and object key at admission, mint only the `PUT` upload capability before `POST /videos/generations`, and mint the `GET` download capability fresh at video completion time (`status === "done" || status === "completed"`), using `Effect.catch` in Effect v4.

3. **Canonical symlink verification and HTTPS reference validation in compatibility media tools (`R10`)**:
   - **Observed**: Compatibility `GrokBuildMedia` checked `ctx.ask({ permission: "read", patterns: [resolved] })` on the lexical path before reading a local reference image, without verifying that `realpath(resolved)` after opening/statting still matched the authorized path, and did not forward `cfg.grok_media` / `cfg.media` model overrides from `registry.ts`.
   - **Expected**: Verify `realpath(resolved)` against `realpath(path.dirname(resolved))` and re-authorize if a symlink points outside the originally authorized path; reject non-HTTPS remote URLs (`http://`); support WebP (`RIFF....WEBP`) alongside PNG/JPEG; and wire `cfg.grok_media` / `cfg.media` options into `GrokBuildTools.adaptTools`.

4. **Missing local diagnostic trace bundle CLI (`apexo trace <sessionID>`, `R11`)**:
   - **Observed**: Installed Grok Build (`1.0.60`) provides `grok trace [--local] [-o <path>] [--json] <session-id>` to export a `.tar.gz` bundle containing `<session-id>/summary.json`, `usage.json`, `events.jsonl`, `chat_history.jsonl`, `trace_config.json`, and `export_metadata.json`, refusing to overwrite an existing `-o` path (`"Not exported: <path> already exists. Choose a new file name."`). Apexo lacked a `trace` CLI command.
   - **Expected**: Implement `apexo trace <sessionID>` (`packages/apexo/src/cli/cmd/trace.ts`) supporting `--local`, `-o/--output <path>` (atomic `wx` no-overwrite enforcement), `--json`, `--sanitize` (deterministic SHA-256 prefix redaction of prompt/message/title/path strings), `--attach`, and `--session-protocol` across native and compatibility sessions.

## Reproduction Steps

1. Run adversarial unit and E2E media suites in `packages/apexo`:
   `bun test test/tool/native-media-options.test.ts test/tool/grok-build-media.test.ts test/e2e/v2-media-options.e2e.test.ts test/e2e/v2-media.e2e.test.ts`
2. Run trace and usage CLI suites in `packages/apexo`:
   `bun test test/cli/trace.test.ts test/cli/usage.test.ts`
3. Run live CLI, rebuilt Desktop, and installed Grok Build (`1.0.60`) acceptance scripts:
   - `bun script/grok-native-media-options.mjs cli` and `desktop`
   - `bun script/grok-media-parity.mjs cli` and `desktop`
   - `APEXO_GROK_BUILD_BIN=/Users/hawk_wu/.grok/bin/grok bun script/grok-media-options-official.mjs`

## Root Cause and Fix

- **`packages/core/src/config/media.ts` & `packages/core/src/config/grok-media.ts`**:
  - Added `zdr_only`, `disable_zdr_incompatible_tools`, `team_blocked_reasons`, `ConfigMedia.isZdrActive`, and fail-closed ZDR video validation.
- **`packages/core/src/tool/media-s3.ts` & `packages/core/src/tool/media.ts`**:
  - Split `MediaS3.signUpload` (`PUT`) and `MediaS3.signDownload` (`GET`), extracted `providerClaims` from `xai` provider settings/body, and deferred `GET` signing until video completion.
- **`packages/apexo/src/tool/grok-build-media.ts` & `packages/apexo/src/tool/registry.ts`**:
  - Wired model overrides, ZDR fail-closed checks, WebP decoding, canonical symlink read verification, and completion-time `GET` signing using `Effect.catch`.
- **`packages/apexo/src/cli/cmd/trace.ts` & `packages/apexo/src/index.ts`**:
  - Implemented `TraceCommand` (`apexo trace <sessionID>`) and registered it in the CLI entrypoint.

## Verification

- Media unit & E2E suites (`packages/apexo`):
  - `bun test test/tool/native-media-options.test.ts test/tool/grok-build-media.test.ts test/e2e/v2-media-options.e2e.test.ts test/e2e/v2-media.e2e.test.ts` -> **43 pass, 0 fail, 312 assertions**.
- Trace & Usage CLI suites (`packages/apexo`):
  - `bun test test/cli/trace.test.ts test/cli/usage.test.ts` -> **14 pass, 0 fail, 137 assertions**.
- Live CLI + rebuilt Desktop + Grok Build (`1.0.60`) parity:
  - `bun script/grok-native-media-options.mjs cli` & `desktop` -> **5/5 checks, 8 language calls each**.
  - `bun script/grok-media-parity.mjs cli` & `desktop` -> **7/7 scenarios each**.
  - `APEXO_GROK_BUILD_BIN=/Users/hawk_wu/.grok/bin/grok bun script/grok-media-options-official.mjs` -> **5/5 official scenarios passed**.
  - Live `apexo trace` against CLI and Desktop native sessions -> **2/2 modes passed (`--local --json`, `--sanitize`, `-o` existing-file rejection)**.
