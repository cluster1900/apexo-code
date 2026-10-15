# BUG-20261015-258: Read-only Memory preview requested conflicting SQLite flags

- **Scope:** Private native migration preview of an existing Memory V2 database.
- **Observed:** Actual CLI GET migration preview returned HTTP 500 after reopening a Session whose Memory database existed. The same preview on a missing scope passed. A temporary child-host diagnostic identified `SQLiteError: flags must include SQLITE_OPEN_READONLY or SQLITE_OPEN_READWRITE` at the canonical Bun SQLite constructor.
- **Cause:** The caller set `readonly: true` and `create: false`, but omitted `readwrite`; the canonical layer's existing default is `readwrite: true`. Bun rejects the contradictory flags.
- **Fix:** Set `readwrite: false` explicitly at this read-only caller. Global SQLite adapter defaults are unchanged. Temporary diagnostic logging was removed.
- **Verification:** The unchanged real CLI scenario then passed all six checks, including preview/apply/retry on the reopened database. The store test now opens an existing database through the passive preview and compares its real generation. Missing-scope preview still creates no database. Commands from `packages/apexo`: `bun test test/tool/memory-migration-native.test.ts`; `bun script/grok-memory-dream-native.mjs cli`. This is one failure episode; its diagnostic rerun is not another recurrence.
