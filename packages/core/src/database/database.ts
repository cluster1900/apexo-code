export * as Database from "./database"

import { EffectDrizzleSqlite } from "@apexo/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { existsSync } from "fs"
import { LEGACY_DB_NAME } from "../legacy-compat"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA busy_timeout = 5000")
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const applied = yield* db.run("PRAGMA journal_mode = WAL").pipe(
        Effect.as(true),
        Effect.catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if ((!message.includes("SQLITE_BUSY") && !message.includes("database is locked")) || attempt === 7)
            return Effect.fail(error)
          return Effect.sleep(`${20 * 2 ** attempt} millis`).pipe(Effect.as(false))
        }),
      )
      if (applied) break
    }
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)").pipe(Effect.catch(() => Effect.void))
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.APEXO_DB) {
    if (Flag.APEXO_DB === ":memory:" || isAbsolute(Flag.APEXO_DB)) return Flag.APEXO_DB
    return join(Global.Path.data, Flag.APEXO_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.APEXO_DISABLE_CHANNEL_DB === "1" ||
    process.env.APEXO_DISABLE_CHANNEL_DB === "true"
  )
    return dbFile("")
  return dbFile(`-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}`)
}

// apexo<suffix>.db, or an existing database with the legacy name (legacy-compat.ts) when no
// Apexo database exists yet, so sessions from earlier installs stay available.
function dbFile(suffix: string) {
  const file = join(Global.Path.data, `apexo${suffix}.db`)
  if (existsSync(file)) return file
  const legacy = join(Global.Path.data, `${LEGACY_DB_NAME}${suffix}.db`)
  return existsSync(legacy) ? legacy : file
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
