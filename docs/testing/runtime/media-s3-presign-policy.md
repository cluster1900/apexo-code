# BUG-20261014-050: S3 presign policy diverged from the official video lifecycle

- Scope: Grok Build video storage signing.
- Observed behavior: Source comparison showed Apexo allowed a 60-second expiry, shorter than the generation/download window, and rejected incomplete optional read-only credentials instead of using the valid writer credentials.
- Expected behavior: Match the pinned official 480-second minimum (300 generation + 120 download + 60 margin) and fall back to writer credentials when the reader pair is incomplete.
- Reproduction: Sign video output with `expires_secs: 1` and a read-only credential pair whose secret is whitespace. Previously the operation threw; without that pair the URL expired after 60 seconds.
- Root cause: The initial local signer implemented generic S3 limits without the official video lifecycle floor or credential-selection rules.
- Fix: Apply the 480-second floor and use read-only credentials only when both fields are nonblank. Preserve the seven-day S3 upper bound and trim key-prefix whitespace as the official implementation does.
- Verification: `bun test test/tool/grok-build-media.test.ts test/tool/grok-build-extensions.test.ts test/tool/grok-build.test.ts` from `packages/apexo`: 37 passed, 132 assertions. The regression asserts the expiry and writer credential identity. Independent Bun GET/PUT signature comparisons pass. A completed upload followed by a 403 GET remains an error without signed URLs or credentials in output. `bun typecheck` from `packages/apexo`: passed.
- Occurrences: One source-audit finding, no observed production storage failure. No recurring constraint is promoted.
