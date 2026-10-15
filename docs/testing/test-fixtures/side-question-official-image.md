# BUG-20261014-086: Side-question fixture PNG failed integrity validation

- Scope: installed Grok side-question comparison; repeated image assertion failures after successful text/context checks.
- Observed: the side answer succeeded, but its provider request omitted the attached image. The first assertion required original base64 bytes in the last request; the correlated rerun showed the same missing image.
- Expected: a valid fixture image reaches the provider as an image content block, allowing normalization.
- Reproduction: run the installed-runtime side-question comparison with the initial one-pixel PNG literal.
- Root cause: retained correlated request evidence includes the reference runtime's notice: `image bytes are truncated`. The fixture literal was invalid (two runs). Generated replacements then exposed separate reference image-size constraints: a 1×1 image was below the eight-pixel minimum side, and a 16×16 image was below the 512-pixel minimum area. The earlier request-correlation/raw-byte assumptions complicated diagnosis but were not the proven cause of the omission.
- Fix: generate a valid 32×32 PNG with a complete IHDR, zlib-compressed RGB scanline, IEND, and valid chunk CRCs. Reuse it in native/terminal/browser fixtures. Correlate provider requests by question marker and inspect normalized image content rather than raw byte identity.
- Verification: installed-runtime comparison passed all three checks with the valid 32×32 image. Earlier Apexo local-provider image checks verified transport, not image decoding; native V2 HTTP passed 1 test with 13 assertions, mini PTY passed 8 checks, and fullscreen PTY passed 9 checks with the valid fixture.


## Independent headless fixture occurrence (2026-10-15)

The installed headless comparison independently reused the same invalid one-pixel PNG literal. After seven successful format/text scenarios, its image assertion failed. The actual current user message contained an `image_dropped_notice` stating that image bytes were truncated. This is the second independent authoring episode; the original two correlated side-question runs remain one episode, not two.

The fixture now reuses the already verified 32×32 PNG and checks a normalized `image_url` content part rather than original byte identity. Final `bun script/grok-native-headless-official.mjs` passed all sixteen scenarios, including actual image transmission, with 19 conversation and 60 auxiliary requests; all processes/listeners were reaped. Earlier native headless PNG results using the old literal prove transport only, not decoding. The integration owner also replaced the two shared native acceptance-script literals and verified every PNG chunk CRC, 32×32 RGB dimensions and complete 3104-byte decompression. Shared compiled file acceptance passed seven checks with four provider requests; compiled mixed attach against packaged Desktop passed seventeen checks with twenty-two provider requests. Both runs exited zero and were reaped; shared Core/Apexo typechecks passed. No product converter or permission policy changed.
