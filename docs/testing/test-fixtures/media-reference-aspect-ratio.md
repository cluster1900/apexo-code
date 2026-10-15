# BUG-20261014-033: Official reference-video fixture omitted required aspect ratio

- Scope: Installed Grok reference-to-video comparison fixture.
- Observed behavior: The first added reference-video scenario failed argument parsing with `missing field aspect_ratio`; it did not reach the media endpoint.
- Expected behavior: The comparison provides the complete official tool argument shape and reaches generation, polling, and storage download.
- Reproduction: Call installed Grok `reference_to_video` with prompt, images, first frame, keyframes, and duration but no aspect ratio.
- Root cause: The fixture relied on Apexo's optional aspect ratio. The pinned official `ReferenceToVideoInput` requires that field.
- Fix: Supply `aspect_ratio: "16:9"` in the official scenario and the shared full-parity reference-video fixture. Align Apexo with the same required aspect-ratio schema, add rejection of blank voice identifiers, and cover both boundaries in the media unit suite.
- Verification: `bun script/grok-media-official.mjs` from `packages/apexo`: passed all four media tools. The reference-video request contained `aspect_ratio`, `reference_images`, first-frame `image`, keyframes, and S3 output; the signed GET completed without xAI authorization.
- Occurrences: One observed fixture failure. No recurring constraint is promoted.

Final boundary verification: the combined media, extension, and profile unit suites passed 37 tests (130 assertions), and package typecheck passed.
