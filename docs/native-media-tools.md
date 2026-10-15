# Native media tools

Status: shared backend integration and scoped CLI/rebuilt Desktop acceptance passed; production renderer acceptance remains pending. These are canonical native tools, independent of the compatibility Tool.Def implementation and the Grok executable.

## Supported contract

The Location-scoped registry supplies `image_gen`, `image_edit`, `image_to_video`, and `reference_to_video`. They resolve the enabled native xAI provider and API-key connection/configuration, use Apexo permissions and FileMutation, and execute HTTP media work inside the existing owning Session drain. They do not start another language-model loop. Each successful tool resumes through the ordinary provider-turn boundary.

Images use `grok-imagine-image-quality`, one output, 1k resolution and default automatic aspect ratio. Editing accepts one or more image references. References may be chronological `[Image #N]` user attachments, local files, PNG/JPEG/WebP data URLs, or HTTPS URLs. Local reads require the ordinary read and external-directory permissions and enforce the existing 20 MiB media-ingest limit.

Videos use `grok-imagine-video-1.5` and default to six seconds at 480p. Image-to-video supports six or ten seconds. Reference-to-video supports one to fifteen seconds, up to fourteen images, three preset voice identifiers and four interior keyframes, with distinct positions rounded to the one-third-second grid. At least one reference is required.

Outputs are new UUID-named files under `.grok/sessions/<encoded Session ID>/images/` or `videos/`, resolved through the canonical Location filesystem boundary. The structured result contains the saved path and MIME. Images also supply a normalized model-facing image preview. Videos supply the saved path as text, never a model-facing video file part. UI video playback is a separate pending presentation step.

## Permission, transport and ownership boundaries

Media action and exact output-target permissions are checked before outbound work. Since image response format is not known in advance, the tool reserves one basename and authorizes all three possible PNG/JPEG/WebP filenames; denying any candidate rejects the operation before billed work. MP4 has one candidate. Canonical output identity is revalidated before the final owned file commit. Existing agent/Task authority remains enforced by PermissionV2; no separate policy engine is introduced.

API requests reject redirects. Download requests do not inherit provider authorization or custom headers and also reject redirects. Image payloads are bounded at 20 MiB; video downloads at 100 MiB. Image bytes must have a supported signature and pass the actual image normalizer. MP4 validation checks its container signature, not full playback correctness. Video polling has a five-minute overall deadline. Local loopback HTTP is available for isolated fixtures; remote endpoints require HTTPS.

The tool captures its Session incarnation before asynchronous work. Only final file creation uses the short lifecycle mutation lease; HTTP, polling, credential resolution and permission waits stay outside that lease. Deletion joins the owning drain, and a late response cannot write into a recreated Session. This does not promise physical cancellation of a remote job already accepted by the service. Media billing is not language-model token usage, and no token receipts are fabricated.

## Verification

All commands below run from `packages/apexo` with pinned Bun 1.3.14 unless stated otherwise.

- `bun test test/e2e/v2-media.e2e.test.ts`: 14 tests / 104 assertions passed against real native HTTP, canonical tools and local provider endpoints. Coverage includes all four capabilities, ordinary continuation, exact extension denial, action/read/edit/external denial, absent credentials, oversized local references and responses, invalid images, redirect refusal, download credential separation, WebP preservation, and held-request deletion followed by same-ID reuse.
- Root `bun turbo typecheck --concurrency=2`: all 21 package tasks passed after shared integration.
- `bun script/grok-native-media.mjs cli` and `desktop`: each passed five checks with eight language-provider requests, four media-generation/edit submissions, two polls and two downloads. Desktop was rebuilt from the integrated source with the preserved model-catalog fixture.
- `APEXO_GROK_BUILD_BIN=<isolated installed executable> bun script/grok-media-official.mjs`: four comparison scenarios passed. HOME, GROK_HOME and all five XDG directories were isolated; unrelated compatibility discovery was disabled. Pinned source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` supplies the behavioral reference. Installed ACP did not advertise `imagine` or `imagine-video`; no slash-command support is inferred.
- Production browser/native-window media previews and terminal presentation: pending. The tiny MP4 backend fixture proves transport/path handling only, not playable-video rendering.

The independent installed comparison exercises reference S3 output, which is not implemented in this native slice. Native custom S3 output and model overrides remain open. Upstream tests are not counted as Apexo verification.

## Findings and limits

The extension-deny regression was red before the exact-target repair. The analogous compatibility implementation was separately reproduced and repaired; both paths now have CLI/rebuilt Desktop allow/deny verification; see [BUG-20261015-115](testing/permissions/native-media-output-target.md). The first API-redirect fixture timeout has no established product cause; a later passing bounded run does not close [BUG-20261015-110](testing/test-stability/native-media-api-redirect-timeout.md).

A separate accepted Session-ID/report-cleanup mismatch was exposed by the first deletion fixture and is repaired independently by the parent integration. The canonical-ID media regression does not constitute that repair. Shared integration preserved the background Task implementation and that independent report-path correction.
