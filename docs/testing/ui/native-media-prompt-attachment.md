# BUG-20261015-124: Native image attachments crashed transcript projection

- **Scope:** App native Session transcript normalization.
- **Observed:** A real native Session with an admitted image prompt opened the App error boundary before its completed media tools could render. Error details reported `Cannot read properties of undefined (reading 'type')` in the user-file projection.
- **Expected:** Current URI attachments, including those without an optional source mention, render normally. Older vendored facade attachments remain readable.
- **Reproduction:** Admit a native prompt containing `{uri, mime}` through the actual Session API, complete a media tool, then open that Session in the production App renderer.
- **Root cause:** The App's vendored client types describe the older `{data, source: {type}, mention?}` attachment. Its adapter dereferenced `file.source.type`; the current canonical Schema stores `{uri, mime, name?, source?: mention}`. Current source is optional and is a mention, not a URI discriminator.
- **Fix:** Project the canonical native attachment variant by `uri`, preserving optional source mentions, while retaining the older inline/URI facade variant and mentions. Projection alone grants no file read authority.
- **Verification:** Actual production-browser failure captured before the fix. Focused App regressions cover current URI/data-URI/optional-mention and old facade inline/URI/mention cases. Combined reader/projection tests pass four tests / nine assertions; App typecheck passes. Rebuilt production browser and actual Electron each pass twelve checks, including both decoded image tools and native image prompt attachments.

Shared integration: the final browser and actual rebuilt Desktop fixture each passed 12 checks / ten calls with decoded and visibly presented video frames; App tests passed four / nine and all 21 package typechecks passed. The screenshot-framing correction is recorded separately in [BUG137](../test-fixtures/media-video-visibility.md).
