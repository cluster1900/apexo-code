# Native media model selection and S3 output

This slice runs inside Apexo's native Location tools. It does not embed Grok orchestration or require the Grok executable at runtime.

## Configuration

Native configuration accepts `media.image_gen_model_override` and `media.image_edit_model_override` independently. `GROK_IMAGE_GEN_MODEL_OVERRIDE` and `GROK_IMAGE_EDIT_MODEL_OVERRIDE` take precedence over the respective configured values. Empty or whitespace-only values fall through; omitted selections use `grok-imagine-image-quality`. These are xAI media API model strings, not chat `provider/model` references. Native video remains `grok-imagine-video-1.5`. Invalid selected model strings fail before outbound work. One invocation captures its configuration and selected credential values; later changes do not retarget it.

The same optional `media` leaf is accepted in legitimate V1 documents and explicitly forwarded into native configuration. Existing compatibility `grok_media` plaintext credentials are not automatically migrated.

```json
{
  "media": {
    "image_gen_model_override": "my-image-generation-model",
    "image_edit_model_override": "my-image-edit-model",
    "video_output": {
      "type": "s3",
      "bucket": "my-video-bucket",
      "endpoint": "https://s3.example.com",
      "region": "us-east-1",
      "key_prefix": "apexo-videos",
      "expires_secs": 900,
      "read_write": {
        "access_key_id_env": "VIDEO_WRITE_KEY_ID",
        "secret_access_key_env": "VIDEO_WRITE_SECRET"
      },
      "read_only": {
        "access_key_id_env": "VIDEO_READ_KEY_ID",
        "secret_access_key_env": "VIDEO_READ_SECRET"
      }
    }
  }
}
```

Omitted `video_output`, or `{ "type": "provider" }`, retains provider output download behavior. S3 configuration uses environment variable names, not secret values. This slice supports static access-key pairs; session tokens, credential discovery and OAuth storage credentials are not supported. TTL is explicitly bounded to 480–604800 seconds, default 900; prefix defaults to `grok-videos`. A configured read-only credential pair must resolve successfully; if it is omitted, GET uses the write pair. Unlike the reference's invalid-read-only fallback, a broken explicit credential selection fails closed. Endpoint user information, query strings, fragments, insecure non-loopback HTTP and dot-segment object prefixes are rejected.

A rejected configuration document with an explicit media selection retains an internal invalid marker. It cannot expose lower-priority provider defaults, even when other fields in that document are also invalid. No permissions or providers are salvaged from rejected documents. A valid higher-priority explicit media selection can replace the marker. This internal marker is not part of public `Config.Info` and does not contain original values or resolved secrets.

## Permissions, output and lifetime

The canonical media tool permission, exact local output target permission and `media_upload` permission on the exact encoded `s3://bucket/key` resource precede provider work and PUT capability generation. Local reference reads and external-directory checks remain unchanged. S3 PUT capabilities bind an MP4 content type and one generated object key. The xAI provider receives only that upload capability; storage GET requests receive no xAI authorization or configured provider headers. Redirects are refused.

Both video tools wait for generation, then download the signed GET into the existing bounded native MP4 path. The output remains durable `{path,mime}` on the completed tool receipt. No signed URL, storage secret or native video model part is persisted as the result. An expired or failed GET is a tool failure, not an invented remote success. The existing UI can explicitly preview the saved local MP4.

Network work remains inside the Session's joined native execution lifetime, outside mutation leases. Final local file creation checks the original Session incarnation and canonical target. Cancellation and deletion prevent late local publication into a reused Session. They do not promise to cancel an already accepted external generation or delete customer-owned remote objects. Customer bucket retention remains customer-controlled; Session deletion does not send remote DELETE requests. S3 routing alone is not a claim of end-to-end zero data retention.

## Reference and acceptance boundaries

Pinned Grok revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` defines separate image generation/edit overrides in `xai-grok-shell/src/agent/config.rs` and `media_tool_config.rs`, and S3 completion/download behavior in `xai-grok-tools/src/implementations/grok_build/video_gen/mod.rs`. The isolated installed 1.0.52 comparison confirms environment generation override, independent configured edit override, read-only signed GET, local download for both video tools, and failed-tool behavior when a previously minted GET returns 403. Its PUT signature includes `content-type:video/mp4`.

The reference also contains a narrow remote-link fallback: initial GET signing must have failed; later signing/download must fail; a final GET signing must then succeed. Static local signing did not demonstrate that branch. Remote-only fallback, opaque durable remote assets, renewal and remote preview remain unimplemented and are not claimed as parity.

Private validation uses local provider/storage fixtures with actual native HTTP tools and real files. It does not certify an external S3 deployment or paid media generation. Signature vectors were independently checked against aws4 1.13.2; these checks support Apexo's signer and are not counted as upstream test acceptance.

Verification on the private coherent checkpoint:

- `bun test test/tool/native-media-options.test.ts test/e2e/v2-media-options.e2e.test.ts test/e2e/v2-media.e2e.test.ts` from `packages/apexo`: 32 tests / 231 assertions passed. This includes the existing native media suite, all new options cases, actual storage PUT/GET, credential changes after admission, denied upload, failed/redirected download, held-download deletion and ID reuse, invalid-document precedence and Config API rejection.
- Core and Apexo package `bun typecheck`: passed after the final carrier change and fixture type corrections.
- `bun script/grok-native-media-options.mjs cli`: five checks / eight ordinary language-provider calls passed on the final source.
- `bun script/grok-media-options-official.mjs` with an explicit isolated installed binary: five reference scenarios passed. This comparison is separate from Apexo verification.

## Team ZDR policy and completion-time GET presigning (`R10`)

Native media configuration also accepts `media.disable_zdr_incompatible_tools`, `media.team_blocked_reasons`, and `media.video_output.zdr_only` (as well as environment variables `GROK_DISABLE_ZDR_INCOMPATIBLE_TOOLS` and `GROK_TEAM_BLOCKED_REASONS`, plus xAI provider claims in `providers.xai.api.settings` or `providers.xai.request.body`). Only supported ZDR claims (`BLOCKED_REASON_NO_LOGS`, `BLOCKED_REASON_NO_LOGS_MODERATED`, or `disable_zdr_incompatible_tools`) activate ZDR; unrelated `team_blocked_reasons` values are ignored.

When ZDR is active:
- `image_to_video` and `reference_to_video` fail closed before outbound provider work unless S3 video output is active (`"Team Zero Data Retention (ZDR) policy requires S3 video output storage for video generation"`).
- `video_output` with `zdr_only: true` activates S3 routing only when ZDR is active and falls back to `"provider"` output when ZDR is inactive.
- `MediaS3.signUpload` mints only the `PUT` upload capability before `POST /videos/generations`, while `MediaS3.signDownload` mints the `GET` download capability fresh at video completion time (`status === "done" || status === "completed"`) using the credentials captured at admission.

Verification on the Phase 4 (`R10`) checkpoint:
- `bun test test/tool/native-media-options.test.ts test/tool/grok-build-media.test.ts test/e2e/v2-media-options.e2e.test.ts test/e2e/v2-media.e2e.test.ts`: **43 pass, 0 fail, 312 assertions**.
- `bun script/grok-native-media-options.mjs cli` and `desktop`: **5/5 checks, 8 language calls each**.
- `bun script/grok-media-parity.mjs cli` and `desktop`: **7/7 scenarios each**.
- `APEXO_GROK_BUILD_BIN=/Users/hawk_wu/.grok/bin/grok bun script/grok-media-options-official.mjs`: **5/5 scenarios passed** on installed Grok Build `1.0.60`. See [BUG-20261017-388](testing/runtime/phase4-media-trace-and-acceptance.md).

