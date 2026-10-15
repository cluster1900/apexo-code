# BUG-20261014-051: Image generation defaults diverged from the official request

- Scope: Grok Build `image_gen` and image aspect-ratio inputs.
- Observed behavior: Deterministic installed-official protocol comparison returned `aspect_ratio: auto` and `resolution: 1k`; Apexo's source selected `1:1` and omitted resolution. Apexo also constrained image aspect-ratio inputs to enums, whereas official image generation and editing accept strings.
- Expected behavior: Preserve the official default payload and accepted input shape.
- Reproduction: Execute `image_gen` with only a prompt against a recording local API; compare its body with the installed official runtime's body.
- Root cause: Initial image generation reused video aspect-ratio constraints and assumed a square default.
- Fix: Default image generation to `auto`, send `resolution: 1k`, and use optional string aspect ratios for image generation/editing. Keep video ratios constrained to the official seven values.
- Verification: The extension test asserts `auto` and `1k` in the generated request. `bun script/grok-media-official.mjs` from `packages/apexo` passed all four media scenarios and recorded the official defaults. Final combined regression results are recorded in the media parity document.
- Occurrences: One protocol/source comparison finding, no observed paid-generation failure. No recurring constraint is promoted.
