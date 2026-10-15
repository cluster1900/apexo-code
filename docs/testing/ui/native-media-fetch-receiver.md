# BUG-20261015-127: Local video reader bound native fetch to an options object

- **Scope:** Private native media App reader draft; not a shipped regression.
- **Observed:** Both native images rendered after the attachment correction, but clicking video preview immediately displayed the safe unavailable message. No filesystem request reached the server.
- **Expected:** The supplied browser or platform fetch performs the authenticated Location-contained read after explicit user action.
- **Root cause:** Calling `input.fetch(...)` bound native `Window.fetch` to the options object. A direct real Chrome probe returned `TypeError: Failed to execute fetch on Window: Illegal invocation`; an unbound call returned the expected bytes. Native Bun transport tests alone did not expose this browser receiver constraint.
- **Fix:** Bind the supplied function to a local `const fetch` and invoke that function without an object receiver. Custom platform fetch remains supported.
- **Verification:** Real Chrome probe reproduced the receiver difference. App native transport tests use a custom forwarding fetch and a real authenticated HTTP server. Production browser and Electron each passed twelve media checks, including actual video dimensions/playback and passive navigation, across English, Simplified Chinese and Traditional Chinese. No permission, redirect or byte-limit check was removed.

Shared integration: the final browser and actual rebuilt Desktop fixture each passed 12 checks / ten calls with decoded and visibly presented video frames; App tests passed four / nine and all 21 package typechecks passed. The screenshot-framing correction is recorded separately in [BUG137](../test-fixtures/media-video-visibility.md).
