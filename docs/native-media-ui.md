# Native media presentation

This slice displays Apexo-owned native media results in the existing App/Session UI. It does not change media orchestration, provider models, permissions, persistence or the model transcript. Browser and Electron use the same presentation.

Native image file parts retain their existing decoded preview. The four canonical media tools retain validated structured path/MIME metadata across fetched history and success events. Completed `image_to_video` and `reference_to_video` results gain a UI-only saved-file attachment; no native video model part is created.

A saved MP4 initially shows its filename and a localized **Preview video** action. Only explicit activation reads the file. The reader uses the selected server's authentication and existing Location-contained filesystem endpoint, refuses redirects, validates MP4 MIME, bounds header and streamed bytes at 100 MiB, and has cancellation and a 30-second deadline. Paths outside the Location remain unavailable; this UI does not widen filesystem scope. Errors show existing fixed localized copy without private server causes.

A successful read owns one Blob URL for the mounted saved URI. The existing player provides playback controls and a download link. Navigation, replacement and unmount abort the owned read and revoke its Blob URL. Reload starts lazy again. Existing direct image/audio/compatibility attachments retain their prior handling.

The native prompt adapter also accepts the current canonical URI/optional-mention attachment shape while retaining the older vendored facade's inline/URI shape. This fixes a real image-prompt transcript crash without changing attachment authority.

## Verification boundaries

- App focused projection/reader tests pass 4 tests / 9 assertions. The reader runs five actual native HTTP checks in a child process to avoid HappyDOM/native transport identity mixing. It checks custom forwarding fetch authentication, exact path/query, outside-path rejection, redirects, MIME, byte limit and held-response cancellation; owned listeners and child exit normally.
- All 21 shared package typechecks pass. Shared App and Desktop production builds pass.
- Shared production browser and actual rebuilt Electron window each passed 12 checks with ten local fixture provider calls, covering both images, both videos in en/zh/zht, decoded dimensions and presented frames, playback advancing after seeking to two seconds, explicit read only, reload staying lazy, Blob cleanup on navigation, missing-file error and no extra provider work. The final fixture additionally reveals the expanded player and verifies frame visibility before screenshots; [BUG137](testing/test-fixtures/media-video-visibility.md) records why the original browser captures were cropped. Final colored-frame screenshots were inspected and both processes exited zero.
- The playable MP4 is the repository's existing help asset served by an explicitly labeled local provider fixture. These checks do not claim paid-service generation or upstream implementation acceptance. The earlier backend comparison remains separate.
- Actual mini/fullscreen acceptance is not complete. Pure-native attach uses legacy bootstrap endpoints; coherent mixed-server probes opened the Session, but the native API returned three messages while the legacy transcript endpoint returned an empty array. Both actual terminals displayed an empty conversation and their media transcript assertions failed. No legacy execution bridge is added by this UI slice.
- The [fixed-backend production composer comparison](testing/performance/native-media-plan-composer.md) is complete. Plan-only UI measured 114.5 ms median / 118 ms p95; adding media measured 110.5 / 126 ms with no Long Task entries. These small samples do not establish a causal timing difference. Shared integration and rebuilt renderer reruns are complete; native-only terminal acceptance remains separate.

Run renderer checks from `packages/apexo`: `bun script/grok-native-media-ui.mjs browser --locales` and `bun script/grok-native-media-ui.mjs native --locales`. The diagnostic terminal script is `bun script/grok-native-media-tui.mjs` with optional `--fullscreen`; its current failures are not reported as successful media rendering.

Separate remaining capabilities include independent `image_gen` and `image_edit` model overrides and reviewed remote/S3 output behavior. This local preview slice makes no parity-completion claim for those capabilities or for native CLI bootstrap.
