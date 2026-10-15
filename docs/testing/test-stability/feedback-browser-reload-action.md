# BUG-20261015-360: Feedback browser action did not reopen after reload

- **Status:** Investigating; no confirmed product or fixture root cause.
- **Scope:** Pure-native production-browser Feedback image acceptance with a denied clipboard profile.
- **Observed:** File selection, image-only save and the server-side saved draft assertions passed. After reload, the Feedback button was present, but the recorded click returned empty output and the expected saved-draft row did not appear within 25 seconds. The final screenshot shows the Session without a Feedback dialog. No new Feedback list request was recorded after reload.
- **Expected:** Opening Feedback after reload lists the saved draft and its original image bytes, before the separate clipboard-denial check begins.
- **Reproduction:** From `packages/apexo`, run pinned Bun 1.3.14 with `bun script/grok-native-feedback-images-ui.mjs desktop --deny-clipboard` against the rebuilt production App.
- **Root cause:** Unknown. The failure preceded the clipboard action, so it does not establish broken clipboard denial or image persistence. The isolated browser confirmed denied clipboard permission. Server logs contain an idle-request timeout, but no causal relationship to the missing dialog has been established.
- **Change:** No production repair. Retain browser action history, HTTP request history, the final screenshot and native-server logs; run an unchanged isolated probe to narrow reproducibility.
- **Verification:** The preceding granted-profile run passed all twelve checks. The unchanged denied-profile rerun also passes twelve, the native window passes eleven, and mini/fullscreen each pass seven. This does not identify the original cause or close this investigation.
- **Occurrences:** One unresolved observation; no recurring constraint.
