# BUG-20261014-031: Decode image attachment file URLs before filesystem access

- Scope: Grok Build image-edit attachment reference resolution.
- Observed behavior: Static review of the new numbered attachment resolver found that reading `URL.pathname` would retain percent escapes in local paths. No production failure was observed before correction.
- Expected behavior: A user image such as `blue square.png` resolves from its `file:` attachment URL to the real filesystem path, and the permission check uses that same decoded path.
- Reproduction: Attach a local image whose filename contains a space, then invoke `image_edit` with `image: ["[Image #1]"]`.
- Root cause: URL path strings and native filesystem paths use different escaping rules.
- Fix: Use Node's `fileURLToPath` for local attachment URLs. HTTPS/data attachments retain their original URL.
- Verification: `bun test test/tool/grok-build-media.test.ts` from `packages/apexo`: 4 passed, including the encoded-file regression. The test writes a valid image with a space in its name, supplies its encoded file URL as a user attachment, verifies the exact decoded read-permission path and outgoing image bytes, and confirms completed output.
- Occurrences: Static discovery during implementation, zero observed production occurrences. No recurring constraint is promoted.
