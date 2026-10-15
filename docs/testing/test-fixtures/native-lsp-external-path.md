# BUG-20261014-266: LSP fixture treated an escaping project symlink as an approved external path

- Scope: Native LSP permission acceptance fixture; no product permission relaxation.
- Observed: The fixture expected a project-relative symlink pointing outside the Location to return file content after general permission allow. It instead returned a tool error before transmission.
- Expected: Apexo rejects project-relative symlink escapes. Explicit absolute external paths may proceed only after external-directory and read authorization.
- Reproduction: Query `link.fixture` pointing outside the test project through the real native LSP tool.
- Root cause: The fixture conflated an explicit external path with a lexical project path whose canonical destination escapes the Location.
- Fix: Assert the symlink escape remains denied. Test explicit absolute external paths separately with a denying agent and an allowing agent; assert denied calls produce no `didOpen` transmission.
- Verification: `bun test test/v2/lsp-native.test.ts` from `packages/apexo` passed three tests and 31 assertions, including both independent boundaries.
