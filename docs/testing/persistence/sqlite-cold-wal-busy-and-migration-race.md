# BUG-20261101-701 — Cold SQLite WAL initialization and migration bootstrap failed across concurrent OS processes

- **Bug ID**: `BUG-20261101-701`
- **Category**: Persistence (`persistence`)
- **Affected Scope**:
  - `packages/core/src/database/sqlite.bun.ts`
  - `packages/core/src/database/sqlite.node.ts`
  - `packages/core/src/database/database.ts`
  - `packages/core/src/database/migration.ts`
  - `packages/apexo/test/v2/doctor-and-v2-hardening.test.ts`
- **Occurrences**: 1 independent episode.

## Observed Behavior

When 6 separate OS processes opened a brand-new SQLite database path at the same instant and ran `DatabaseMigration`, several worker processes failed during initial database open or schema bootstrap with `SQLITE_BUSY: database is locked` (on `PRAGMA journal_mode = WAL`) or raced on cold schema/migration creation when reading the `migration` journal outside a write transaction.

## Expected Behavior

Concurrent OS processes opening a cold or partially migrated SQLite database must serialize WAL mode initialization, initial schema creation, and each pending migration step so that every migration executes at most once and all concurrent callers converge cleanly without `SQLITE_BUSY` or duplicate DDL execution, while keeping a zero-write-lock fast read path when all migrations are already applied.

## Reproduction Steps

Run in `packages/apexo`:

```sh
bun test test/v2/doctor-and-v2-hardening.test.ts
```

## Root Cause

1. In `sqlite.bun.ts`, `sqlite.node.ts`, and `database.ts`, `PRAGMA journal_mode = WAL` was executed before `PRAGMA busy_timeout = 5000` (in `database.ts`) and without a `SQLITE_BUSY` retry loop. During initial `-wal`/`-shm` creation on a brand-new database file, SQLite can return `SQLITE_BUSY` immediately without invoking the connection's `busy_timeout` callback when multiple processes transition the file to WAL simultaneously.
2. In `DatabaseMigration` (`packages/core/src/database/migration.ts`), checking applied migration IDs and bootstrapping the base schema occurred outside an immediate write transaction (`{ behavior: "immediate" }`), allowing concurrent processes to observe the same unmigrated state and race on non-idempotent DDL.

## Fix

1. Set `PRAGMA busy_timeout = 5000` before `PRAGMA journal_mode = WAL` and wrap initial `PRAGMA journal_mode = WAL` execution in `sqlite.bun.ts`, `sqlite.node.ts`, and `database.ts` with bounded exponential backoff retries (`20 * 2 ** attempt` ms, up to 8 attempts) specifically for `SQLITE_BUSY` / `"database is locked"`.
2. Update `DatabaseMigration.apply` and `DatabaseMigration.applyOnly` to preserve a fast read-only check when all migrations are already present in `migration`, and otherwise acquire a SQLite `BEGIN IMMEDIATE` write lock (`db.transaction(..., { behavior: "immediate" })`) and re-verify `sqlite_master` / `migration` inside the immediate transaction before bootstrapping or applying each migration.

## Verification

- `cd packages/apexo && bun typecheck`: passed (exit 0).
- `cd packages/apexo && bun test test/v2/doctor-and-v2-hardening.test.ts`: 3 pass, 0 fail (6-process simultaneous cold SQLite bootstrap + custom migration probe verified `cross_process_probe` row count = `1`).
