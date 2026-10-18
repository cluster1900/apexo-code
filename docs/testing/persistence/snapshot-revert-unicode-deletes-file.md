# Snapshot revert deletes existing files with non-ASCII names

- Bug ID: BUG-20261018-394
- Scope: `packages/apexo/src/snapshot/index.ts` batched revert (undo/redo of agent edits)
- Observed: un-skipping `test/snapshot/snapshot.test.ts` "unicode filenames modification and restore" fails with `NotFound: FileSystem.readFile (.../文件.txt)`. Reverting a patch that *modified* `文件.txt` and `файл.txt` deleted both files instead of restoring their original content (data loss).
- Expected: files that existed in the snapshot are checked out at their snapshot content.
- Root cause: the batched path lists snapshot members with `git ls-tree --name-only` using the `core` config only. Without `core.quotepath=false`, Git prints non-ASCII paths C-quoted (`"\346\226\207..."`), so they never match the requested relative paths in `have`; the code then treats them as files that did not exist in the snapshot and removes them. Other snapshot listing commands already used the `quote` config.
- Fix: run the batched `ls-tree` with the `quote` config (`core.quotepath=false`) and re-enable the test.
- Verification: negative control — the re-enabled test fails before the fix; after the fix `bun test test/snapshot/snapshot.test.ts` passes 56/56 with 0 skips.
