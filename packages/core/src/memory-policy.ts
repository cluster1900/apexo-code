export * as MemoryPolicy from "./memory-policy"

import { eq } from "drizzle-orm"
import { Config, Effect } from "effect"
import { SessionID } from "@apexo/schema/session-id"
import { ConfigMemory } from "./config/memory"
import type { Database } from "./database/database"
import { SessionMemoryBackendTable } from "./session/sql"

export const flags = Config.all({
  profile: Config.string("APEXO_RUNTIME_PROFILE").pipe(
    Config.map((value) => value === "grok-build"),
    Config.orElse(() => Config.succeed(false)),
  ),
  enabled: Config.string("GROK_MEMORY").pipe(
    Config.map((raw) => {
      const value = raw.trim().toLowerCase()
      if (["0", "false", "no", "off", "disabled"].includes(value)) return false
      if (["1", "true", "yes", "on", "enabled"].includes(value)) return true
      return undefined
    }),
    Config.orElse(() => Config.succeed(undefined)),
  ),
})

export const backend = Effect.fn("MemoryPolicy.backend")(function* (
  db: Database.Interface["db"],
  id: SessionID | undefined,
  input: {
    profile: boolean
    memory?: typeof ConfigMemory.Info.Type
    memory_v2?: typeof ConfigMemory.V2.Type
  },
) {
  const settings = input.memory_v2
  const candidate = {
    backend: input.profile && settings?.enabled ? ("v2" as const) : ("legacy" as const),
    rollout: settings?.rollout ?? "active",
    skip_through: null as string | null,
  }
  // First use pins the storage choice; configuration changes must never
  // silently move an existing conversation into a different memory store.
  const existing =
    id && input.profile
      ? yield* db
          .select()
          .from(SessionMemoryBackendTable)
          .where(eq(SessionMemoryBackendTable.session_id, id))
          .get()
          .pipe(Effect.orDie)
      : undefined
  if (id && !existing && input.profile)
    yield* db
      .insert(SessionMemoryBackendTable)
      .values({ session_id: id, ...candidate })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  const pinned =
    existing ??
    (id && input.profile
      ? yield* db
          .select()
          .from(SessionMemoryBackendTable)
          .where(eq(SessionMemoryBackendTable.session_id, id))
          .get()
          .pipe(Effect.orDie)
      : candidate)
  const backend = pinned?.backend ?? candidate.backend
  const stages = ["off", "record_only", "shadow", "active"] as const
  const rollout =
    stages[Math.min(stages.indexOf(pinned?.rollout ?? "active"), stages.indexOf(settings?.rollout ?? "active"))]!
  const restricted = backend === "v2" && (rollout === "off" || settings?.file_writes_enabled === false)
  return {
    backend,
    rollout,
    configured: backend === "v2" ? (settings?.enabled ?? true) : input.memory?.enabled,
    restricted,
    capture: backend === "v2" && !restricted && settings?.capture_enabled !== false,
    expose: backend === "v2" && !restricted && rollout === "active",
    skipThrough: pinned?.skip_through ?? null,
  }
})
