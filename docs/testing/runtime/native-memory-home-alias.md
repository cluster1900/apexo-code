# Non-migrating Memory append passed an alias to a strict canonical reader

- **Bug ID:** BUG-20261015-153
- **Status:** Fixed and verified in the private draft.
- **Scope:** Native non-migrating WorkspaceMemory updates with an aliased home directory.
- **Observed:** The first note write succeeded, but a second append through a real home-directory symlink failed with `Invalid memory migration source`.
- **Expected:** A validated home alias resolves to the same authorized canonical note and preserves both facts. Nested note symlinks remain forbidden.
- **Cause:** The new non-migrating branch validated a canonical target but supplied the original alias to the existing strict reader, which deliberately requires `realpath(file) === file`.
- **Fix:** Use the already validated canonical target for strict read and atomic save. Preserve original selected paths for the existing lock, generation and migration-marker contracts; keep no-follow and identity checks intact.
- **Verification:** A real symlink-home test first failed on its second append, then passed after correction with both original and appended facts present. The three-case boundary gate passed nine assertions. No prior data loss was observed or claimed.

## Shared integration verification

The shared eleven-file Memory/terminal gate passed 96 tests / 371 assertions, including the six-file Memory coverage; all 21 workspace typechecks passed. Shared source CLI and freshly rebuilt Desktop each passed four checks / three provider requests. The five native Memory HTTP inventory scenarios also passed. The separate Memory-context timing observation remains unresolved and is not attributed to this repair.
