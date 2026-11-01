export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@apexo/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
}

function immediate<A, E, R>(db: Database, fn: (tx: Transaction) => Effect.Effect<A, E, R>, retries = 5) {
  const run = (): Effect.Effect<A, E | Effect.Error<ReturnType<Database["transaction"]>>, R> =>
    db.transaction(fn, { behavior: "immediate" }).pipe(
      Effect.catchIf(
        (error) => retries > 0 && /database is locked|SQLITE_BUSY/i.test(String(error)),
        () => Effect.sleep("100 millis").pipe(Effect.andThen(() => immediate(db, fn, retries - 1))),
      ),
    )
  return run()
}

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const tables = yield* db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      if (tables.some((table) => table.name === "session")) return yield* applyMigrations(db, migrations)
      if (tables.length > 0) return yield* Effect.die("Database is not empty and has no session table")
      const initializedByPeer = yield* immediate(db, (tx) =>
        Effect.gen(function* () {
          const current = yield* tx.all<{ name: string }>(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
          )
          if (current.some((table) => table.name === "session")) return true
          if (current.length > 0) return yield* Effect.die("Database is not empty and has no session table")
          yield* schema.up(tx)
          yield* tx.run(
            sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          yield* Effect.forEach(migrations, (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
          )
          return false
        }),
      )
      if (initializedByPeer) yield* applyMigrations(db, migrations)
    }),
  )
}

export function applyOnly(db: Database, input: Migration[]) {
  return lock.withPermit(applyMigrations(db, input))
}

function applyMigrations(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    const hasJournal = yield* db.get(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"migration"}`,
    )
    if (hasJournal) {
      const existing = new Set(
        (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
      )
      if (existing.size > 0 && input.every((item) => existing.has(item.id))) return
    }

    const completed = yield* immediate(db, (tx) =>
      Effect.gen(function* () {
        yield* tx.run(
          sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
        )
        const initial = new Set(
          (yield* tx.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
        if (initial.size > 0) return initial

        // Existing installs used Drizzle's migration journal. Seed the new
        // journal once so TypeScript migrations don't replay old SQL.
        if (
          !(yield* tx.get(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`,
          ))
        )
          return initial

        const named = (yield* tx.all<{ name: string }>(
          sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`,
        )).some((column) => column.name === "name")

        if (named) {
          yield* tx.run(sql`
            INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
            SELECT name, ${Date.now()}
            FROM ${sql.identifier("__drizzle_migrations")}
            WHERE name IS NOT NULL
          `)
        }

        if (!named) {
          const entries = yield* tx.all<{ created_at: number; prefix: string | null }>(sql`
            SELECT created_at, strftime('%Y%m%d%H%M%S', created_at / 1000, 'unixepoch') AS prefix
            FROM ${sql.identifier("__drizzle_migrations")}
            WHERE created_at IS NOT NULL
          `)

          for (const entry of entries) {
            const migration = input.find((item) => item.id.startsWith(`${entry.prefix}_`))
            if (!migration) {
              return yield* Effect.die(
                new Error(`Legacy migration timestamp ${entry.created_at} does not match any known migration`),
              )
            }
            yield* tx.run(sql`
              INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
              VALUES (${migration.id}, ${Date.now()})
            `)
          }
        }
        return new Set(
          (yield* tx.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }),
    )

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* immediate(db, (tx) =>
        Effect.gen(function* () {
          const already = yield* tx.get<{ id: string }>(
            sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`,
          )
          if (already) return
          yield* migration.up(tx)
          yield* tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
      )
    }
  })
}
