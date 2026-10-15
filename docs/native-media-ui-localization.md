# Native media presentation localization review

Existing English media copy is unchanged. This review covers the two additive video-kind and preview-action keys.

The new semantic units are `video` and `Preview video`; existing `ui.fileMedia.state.loading`, `.error` and `.unavailable` may be reused with the new video kind. In zh use 视频 and 预览视频; in zht use 影片 and 預覽影片. Existing repository loading/error grammar remains authoritative and placeholders remain intact.

Evidence reviewed:

- Firefox's maintained [zh-CN context-menu corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-CN/browser/browser/browserContext.ftl) and [zh-TW corpus](https://github.com/mozilla-l10n/firefox-l10n/blob/main/zh-TW/browser/browser/browserContext.ftl) use 预览 / 預覽 for preview actions, and 加载 / 載入 in reload wording. This supports the action and repository terminology; those particular files did not supply the video noun.
- Apple's [Simplified Chinese video-editing instructions](https://support.apple.com/zh-cn/104968) use 视频 and 预览 in playback context. Apple's [Taiwan media-browser instructions](https://support.apple.com/zh-tw/guide/imovie-ipad/kna1cdc919cc/3.0.4/ipados/17.0) use 影片 and 預覽 in the same media-preview context. These provide an independent localized product corpus.
- Taiwan Ministry of Education's [concise dictionary lookup for 影片](https://dict.concised.moe.edu.tw/search.jsp?la=0&md=3&noti=1&powerMode=0&word=%E5%BD%B1%E7%89%87) returns the word as a dictionary entry. The direct expanded definition could not be opened by the browsing tool, so no definition is quoted or claimed as verified.
- Existing repository `packages/ui/src/i18n/{en,zh,zht}.ts` already localizes media loading, unavailable-preview and load-failure states. Preserve these strings and complete-phrase interpolation rather than concatenating grammar in the component.

The proposed action phrase is an adaptation to a clickable video-preview button, not a claim that it is quoted verbatim from the reference interfaces. Video here is a saved media clip (影片), not a live call (視訊). Tool identifiers, MIME values, paths, xAI model names and filenames remain untranslated technical/product tokens. Actual production browser and Electron checks verify en/zh/zht action labels and decoded playable video. Screenshots capture each localized action before loading and the player afterward; the unavailable state reuses existing complete-phrase copy. Tool names, MIME values and generated filenames remain technical tokens, not untranslated UI prose.
