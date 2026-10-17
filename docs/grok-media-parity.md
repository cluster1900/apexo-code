# Grok Build media parity

The Grok Build profile exposes `image_gen`, `image_edit`, `image_to_video`, and `reference_to_video`. `/imagine` and `/imagine-video` are shared server command templates, so CLI and Desktop discover the same entrypoints. Empty descriptions instruct the model to return command usage; these are prompt templates rather than a native argument parser.

`image_edit` follows the official `image: string[]` contract. A single reference becomes the `/images/edits` `image` object with no aspect ratio; multiple references become `images` with default `aspect_ratio: auto`. The payload selects `grok-imagine-image-quality`, `resolution: 1k`, and base64 output. References support local files, HTTPS/data URLs, and numbered user image attachment tokens. Local reads retain directory and read permission checks. Outputs are saved under the session's images directory and returned as preview attachments.

## Optional S3 video storage

Configure host-side storage under `grok_media.zdr_video_output_s3`:

```json
{
  "grok_media": {
    "zdr_video_output_s3": {
      "bucket": "team-videos",
      "endpoint": "https://s3.example.com",
      "region": "us-east-1",
      "key_prefix": "grok/videos",
      "expires_secs": 3600,
      "read_write": { "access_key_id": "REPLACE", "secret_access_key": "REPLACE" },
      "read_only": { "access_key_id": "REPLACE", "secret_access_key": "REPLACE" }
    }
  }
}
```

Defaults match the official runtime: key prefix `grok-videos`, expiry 900 seconds. The example explicitly overrides both. The optional read-only credentials sign downloads; otherwise the read/write credentials sign both operations. The host signs a unique object PUT URL and sends only `output.upload_url` to the xAI generation endpoint. After completion it downloads the same object with a separately signed GET, never forwarding xAI authorization to storage. Download failure remains an error. The URLs and storage credentials are not included in tool outputs. The host implementation uses Node crypto and works in Bun and Electron. Configuration activates this routing explicitly. Automatic team ZDR detection requires the official login metadata `team_blocked_reasons` (`BLOCKED_REASON_NO_LOGS` or `BLOCKED_REASON_NO_LOGS_MODERATED`), which Apexo's current xAI API-key/provider transport does not expose; it cannot safely infer that policy. The official upload-only fallback is entered only if GET presigning failed before generation. Apexo's synchronous static-credential signer always mints GET when PUT succeeds, so that branch is unreachable with the supported transport. A failed GET download remains an error, matching the official pre-minted-GET path. No invented team flags or download-success fallback are used. Expiry has the official 480-second lifecycle floor; incomplete optional reader credentials fall back to the writer pair.

## Verification

- `bun test test/tool/grok-build-media.test.ts test/tool/grok-build-extensions.test.ts`: media protocol, file output, local permissions, cancellation, and independent Bun GET/PUT signature comparison.
- `bun script/grok-media-parity.mjs cli` and `bun script/grok-media-parity.mjs desktop`: isolated actual CLI/Electron servers with deterministic HTTP providers, tool executions, saved files, attachment projection, actual `/imagine` and `/imagine-video` command execution, and separate S3 credentials.
- `bun script/grok-media-official.mjs`: installed Grok ACP runtime with an isolated local model and media endpoint, preserving the official request contract without paid generation.
- `bun typecheck` from `packages/apexo`: passed during implementation.

Protocol fixtures use synthetic media; they establish request routing and lifecycle behavior, not the visual quality of paid xAI output or successful access to a production S3 account. Official source baseline: revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, `image_edit/mod.rs`, `video_gen/mod.rs`, and the pager Imagine command implementations. Fixture failures and corrections are recorded in [BUG-20261014-030](testing/test-fixtures/media-edit-fixtures.md); local attachment URL handling is covered by [BUG-20261014-031](testing/runtime/media-attachment-file-url.md).

### Recorded results (2026-10-14)

- Final combined media, extension, and profile unit suites: 37 passed, 132 assertions, including required reference aspect ratio, blank voices, encoded attachment paths, S3 policy, and failed storage downloads.
- CLI parity: passed all seven scenarios (four tools, two command executions, configured S3 routing).
- Final shared Desktop build parity: passed the same seven scenarios through the Electron backend.
- Installed Grok comparison: passed image generation, image editing, S3 image-to-video and reference-to-video generation with deterministic local protocol fixtures.
- Final package `bun typecheck`: passed.

Desktop verification exercised the actual Electron server bundle and projected preview attachment data. It did not visually inspect rendered image pixels or video playback in a foreground window.

The installed official ACP runtime did not advertise `imagine` or `imagine-video`; the comparison script reports both booleans. Their pinned pager command tests also passed all eight cases (required tools, empty/whitespace usage, valid prompt injection). Foreground official pager interaction remains unverified. The initial incorrect cross-surface assertion is documented in [BUG-20261014-032](testing/test-fixtures/media-official-command-surface.md).

The official reference-video input requires `aspect_ratio`; Apexo now enforces the same requirement and rejects blank voice identifiers. The official fixture supplies `16:9`, as recorded in [BUG-20261014-033](testing/test-fixtures/media-reference-aspect-ratio.md).

Pinned official source verification: `cargo test -p xai-grok-pager slash::commands::imagine --lib` passed 8 tests. The first offline attempt lacked a cached crate; the normal dependency fetch and build then succeeded.

S3 lifecycle floor and reader-credential selection are recorded in [BUG-20261014-050](testing/runtime/media-s3-presign-policy.md).

Image generation uses the official `auto` aspect ratio and `1k` resolution defaults; image generation/editing both accept string aspect ratios, leaving API validation to the provider. See [BUG-20261014-051](testing/runtime/media-image-defaults.md).

### Phase 4 (`R10`) completion (2026-10-17)

- `GrokBuildMedia` and `ConfigGrokMedia` now honor `image_gen_model_override` / `image_edit_model_override` (and `GROK_IMAGE_GEN_MODEL_OVERRIDE` / `GROK_IMAGE_EDIT_MODEL_OVERRIDE`), supported ZDR claims (`BLOCKED_REASON_NO_LOGS`, `BLOCKED_REASON_NO_LOGS_MODERATED`, `disable_zdr_incompatible_tools`), `zdr_only` S3 gating, completion-time `GET` presigning, WebP output (`RIFF....WEBP`), HTTPS-only remote reference URLs, and post-stat canonical `realpath` verification for local reference files. See [BUG-20261017-388](testing/runtime/phase4-media-trace-and-acceptance.md).

