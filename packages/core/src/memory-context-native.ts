export * as MemoryContextNative from "./memory-context-native"

import path from "node:path"
import { MemoryContext } from "./memory-context"
import { MemoryEmbedding } from "./memory-embedding"
import { MemoryMaintenance } from "./memory-maintenance"
import { MemorySearch } from "./memory-search"
import { WorkspaceMemory } from "./workspace-memory"
import { LocationMutation } from "./location-mutation"
import { SessionStore } from "./session/store"
import { SessionIncarnation } from "./session/incarnation"
import { SessionMessage } from "./session/message"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SessionID } from "@apexo/schema/session-id"
import { AgentV2 } from "./agent"
import { Config } from "./config"
import { ConfigMemory } from "./config/memory"
import { Database } from "./database/database"
import { makeLocationNode } from "./effect/app-node"
import { Global } from "./global"
import { Location } from "./location"
import { MemoryPolicy } from "./memory-policy"
import { MemoryV2Catalog } from "./memory-v2-catalog"
import { PermissionV2 } from "./permission"
import { SessionHistory } from "./session/history"
import { SessionMemoryContextTable, SessionMemoryModeTable, SessionMessageTable } from "./session/sql"
import { SystemContext } from "./system-context/index"

export class Service extends Context.Service<
  Service,
  {
    readonly load: (sessionID: SessionID, agent?: AgentV2.ID) => Effect.Effect<SystemContext.SystemContext>
  }
>()("@apexo/MemoryContextNative") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const flags = yield* MemoryPolicy.flags.pipe(Effect.orDie)
    const config = yield* Config.Service
    const database = yield* Database.Service
    const embedding = yield* MemoryEmbedding.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const permission = yield* PermissionV2.Service
    const mutation = yield* LocationMutation.Service
    const sessions = yield* SessionStore.Service
    const documents = (yield* config.entries()).filter((entry) => entry.type === "document")
    const settings = {
      memory: documents.reduce<typeof ConfigMemory.Info.Type>(
        (value, entry) => ({ ...value, ...entry.info.memory }),
        {},
      ),
      memory_v2: documents.reduce<typeof ConfigMemory.V2.Type>(
        (value, entry) => ({ ...value, ...entry.info.memory_v2 }),
        {},
      ),
    }
    const mode = Effect.fn("MemoryContextNative.mode")(function* (sessionID: SessionID) {
      const policy = yield* MemoryPolicy.backend(database.db, sessionID, {
        ...settings,
        profile: flags.profile,
      })
      const row = yield* database.db
        .select()
        .from(SessionMemoryModeTable)
        .where(eq(SessionMemoryModeTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return {
        enabled:
          flags.profile &&
          (policy.backend === "legacy" || policy.expose) &&
          flags.enabled !== false &&
          (row?.enabled ?? flags.enabled ?? policy.configured ?? false),
        revision: row?.revision ?? "initial",
        backend: policy.backend,
      }
    })
    const legacy = Effect.fn("MemoryContextNative.legacy")(function* (
      sessionID: SessionID,
      agent: AgentV2.ID | undefined,
      before: Effect.Success<ReturnType<typeof mode>>,
    ) {
      const session = yield* sessions.get(sessionID)
      if (
        !session ||
        session.location.directory !== location.directory ||
        session.location.workspaceID !== location.workspaceID
      )
        return SystemContext.empty
      const created = yield* SessionIncarnation.created(database.db, sessionID)
      if (!created) return SystemContext.empty
      const compaction = yield* SessionHistory.latestCompaction(database.db, sessionID)
      if (!compaction && settings.memory.initial_injection?.enabled === false) return SystemContext.empty
      const input = { directory: location.directory, home: global.home, projectID: location.project.id }
      const revision = () =>
        Effect.tryPromise(() =>
          Promise.all(
            (["global", "workspace"] as const).map((scope) =>
              MemoryMaintenance.revision(WorkspaceMemory.maintenance(input.directory, input.home, { ...input, scope })),
            ),
          ),
        ).pipe(
          Effect.uninterruptible,
          Effect.map((items) => items.join(":")),
        )
      const permitted = Effect.fnUntraced(function* (paths: readonly string[], action: "read" | "edit" = "read") {
        const inspect = yield* permission.inspect(sessionID, agent)
        for (const file of paths) {
          const resolved = yield* mutation.resolve({ path: file, kind: "file" })
          if (
            resolved.externalDirectory &&
            inspect("external_directory", [resolved.externalDirectory.resource]) !== "allow"
          )
            return false
          if (inspect(action, [file, resolved.canonical]) !== "allow") return false
        }
        return true
      })
      const generation = yield* revision()
      const epoch = `native-legacy:${created}:${compaction?.seq ?? "initial"}:${before.revision}:${generation}`
      const where = and(eq(SessionMemoryContextTable.session_id, sessionID), eq(SessionMemoryContextTable.epoch, epoch))
      const saved = yield* database.db.select().from(SessionMemoryContextTable).where(where).get().pipe(Effect.orDie)
      const snapshot =
        saved ??
        (yield* Effect.gen(function* () {
          const roots = (["global", "workspace"] as const).map((scope) =>
            WorkspaceMemory.file(input.directory, input.home, { ...input, scope }),
          )
          if (!(yield* permitted(roots))) return undefined
          const cache = path.join(
            path.dirname(roots[1]!),
            generation.split(":")[1] === "initial" ? "search.sqlite" : `search-${generation.split(":")[1]}.sqlite`,
          )
          if (
            !(yield* permitted([cache], "read")) ||
            !(yield* permitted([cache, `${cache}-wal`, `${cache}-shm`], "edit"))
          )
            return undefined
          const verifyContextAuthority = Effect.gen(function* () {
            const currentSession = yield* sessions.get(sessionID)
            const currentMode = yield* mode(sessionID)
            if (
              !currentSession ||
              !currentMode.enabled ||
              currentMode.backend !== "legacy" ||
              currentMode.revision !== before.revision ||
              (yield* SessionIncarnation.created(database.db, sessionID)) !== created ||
              (session.agent !== undefined && currentSession.agent !== session.agent)
            )
              return yield* new MemorySearch.MemoryError({ message: "Automatic memory authority changed" })
            return currentSession
          }).pipe(
            Effect.mapError((error) =>
              error instanceof MemorySearch.MemoryError
                ? error
                : new MemorySearch.MemoryError({ message: "Automatic memory authority changed" }),
            ),
          )
          const search = yield* MemorySearch.make({
            ...input,
            search: settings.memory.search,
            embedding: () =>
              Effect.gen(function* () {
                const currentSession = yield* verifyContextAuthority
                return yield* embedding.resolve({
                  embedding: settings.memory.embedding,
                  fallbackProviderID: currentSession.model?.providerID ?? session.model?.providerID,
                })
              }),
            watch: false,
            joinIO: true,
          })
          // Query the last durable real user row, including pre-compaction history; never use assistant/tool arguments.
          const rows = yield* database.db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user")))
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .all()
            .pipe(Effect.orDie)
          const latest = rows[0]
            ? yield* Schema.decodeUnknownEffect(SessionMessage.Message)({
                ...rows[0].data,
                id: rows[0].id,
                type: rows[0].type,
              })
            : undefined
          const text = latest?.type === "user" ? latest.text.trim() : ""
          const query =
            text && text !== "__auto_continue__" && Buffer.byteLength(text) >= 20
              ? text
              : compaction
                ? "project context"
                : "project conventions preferences architecture"
          const result = yield* search.search(
            {
              query,
              max_results: compaction ? 3 : 6,
              min_score: compaction ? 0 : (settings.memory.initial_injection?.min_score ?? 0.9),
            },
            (files) =>
              Effect.gen(function* () {
                yield* verifyContextAuthority
                const allowed = yield* permitted(search.accessPaths(files)).pipe(
                  Effect.mapError(
                    () => new MemorySearch.MemoryError({ message: "Automatic memory read is not permitted" }),
                  ),
                )
                if (!allowed)
                  return yield* new MemorySearch.MemoryError({ message: "Automatic memory read is not permitted" })
              }),
          )
          return {
            content: MemoryContext.format(result.results),
            access_paths: search.accessPaths(result.results.map((item) => item.path)),
          }
        }).pipe(Effect.scoped))
      if (!snapshot || !(yield* permitted(snapshot.access_paths))) return SystemContext.empty
      const after = yield* mode(sessionID)
      if (
        !after.enabled ||
        after.backend !== "legacy" ||
        after.revision !== before.revision ||
        (yield* revision()) !== generation ||
        (yield* SessionIncarnation.created(database.db, sessionID)) !== created
      )
        return SystemContext.empty
      if (!saved)
        yield* database.db
          .insert(SessionMemoryContextTable)
          .values({ session_id: sessionID, epoch, content: snapshot.content, access_paths: snapshot.access_paths })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
      const stored = yield* database.db.select().from(SessionMemoryContextTable).where(where).get().pipe(Effect.orDie)
      if (!stored?.content || !(yield* permitted(stored.access_paths))) return SystemContext.empty
      const finalMode = yield* mode(sessionID)
      if (
        !finalMode.enabled ||
        finalMode.revision !== before.revision ||
        (yield* revision()) !== generation ||
        (yield* SessionIncarnation.created(database.db, sessionID)) !== created
      )
        return SystemContext.empty
      return SystemContext.make({
        key: SystemContext.Key.make("core/memory-legacy"),
        codec: Schema.String,
        load: Effect.succeed(stored.content),
        baseline: (value) => value,
        update: (_previous, value) =>
          `Saved legacy memory context changed. This replaces the previous memory context.\n${value}`,
        removed: () =>
          "Saved legacy memory context is no longer available or permitted. Do not rely on the previously supplied memory context.",
      })
    })
    return Service.of({
      load: Effect.fn("MemoryContextNative.load")(
        function* (sessionID: SessionID, agent?: AgentV2.ID) {
          if (!flags.profile) return SystemContext.empty
          const before = yield* mode(sessionID)
          if (!before.enabled) return SystemContext.empty
          if (before.backend === "legacy") return yield* legacy(sessionID, agent, before)
          const inspect = yield* permission.inspect(sessionID, agent)
          const input = {
            directory: location.directory,
            projectID: location.project.id,
            home: global.home,
            compactIndex: settings.memory_v2.compact_index_enabled,
            permitted: (paths: readonly string[], action: "read" | "edit") => inspect(action, paths) === "allow",
          }
          const generation = (yield* MemoryV2Catalog.context(input, [])).generation
          const compaction = yield* SessionHistory.latestCompaction(database.db, sessionID)
          const epoch = `native-v2:${compaction?.seq ?? "initial"}:${before.revision}:${generation}`
          const where = and(
            eq(SessionMemoryContextTable.session_id, sessionID),
            eq(SessionMemoryContextTable.epoch, epoch),
          )
          const saved = yield* database.db
            .select()
            .from(SessionMemoryContextTable)
            .where(where)
            .get()
            .pipe(Effect.orDie)
          const snapshot = saved ?? (yield* MemoryV2Catalog.context(input))
          if (!saved && "generation" in snapshot && snapshot.generation !== generation) return SystemContext.empty
          const inspectNow = yield* permission.inspect(sessionID, agent)
          const current = yield* MemoryV2Catalog.context(
            {
              ...input,
              permitted: (paths: readonly string[], action: "read" | "edit") => inspectNow(action, paths) === "allow",
            },
            snapshot.access_paths,
          )
          const after = yield* mode(sessionID)
          if (!after.enabled || before.revision !== after.revision || current.generation !== generation)
            return SystemContext.empty
          if (!saved) {
            // Persist even an empty selection: later additions wait for a new epoch.
            yield* database.db
              .insert(SessionMemoryContextTable)
              .values({
                session_id: sessionID,
                epoch,
                content: snapshot.content,
                access_paths: snapshot.access_paths,
              })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
          }
          const stored = yield* database.db
            .select()
            .from(SessionMemoryContextTable)
            .where(where)
            .get()
            .pipe(Effect.orDie)
          if (!stored?.content) return SystemContext.empty
          const finalAuthority = yield* permission.inspect(sessionID, agent)
          const finalSnapshot = yield* MemoryV2Catalog.context(
            {
              ...input,
              permitted: (paths: readonly string[], action: "read" | "edit") =>
                finalAuthority(action, paths) === "allow",
            },
            stored.access_paths,
          )
          const finalMode = yield* mode(sessionID)
          if (!finalMode.enabled || finalMode.revision !== before.revision || finalSnapshot.generation !== generation)
            return SystemContext.empty
          return SystemContext.make({
            key: SystemContext.Key.make("core/memory-v2"),
            codec: Schema.String,
            load: Effect.succeed(stored.content),
            baseline: (value) => value,
            update: (_previous, value) =>
              `Saved memory context changed. This replaces the previous memory context.\n${value}`,
            removed: () =>
              "Saved memory context is no longer available or permitted. Do not rely on the previously supplied memory context.",
          })
        },
        // Memory is optional. A failed or revoked read must not preserve stale content
        // via unavailable-source semantics, nor open an interactive permission request.
        Effect.catchCause(() =>
          Effect.logWarning("Could not load native memory context").pipe(Effect.as(SystemContext.empty)),
        ),
      ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Config.node,
    Database.node,
    MemoryEmbedding.node,
    Location.node,
    Global.node,
    PermissionV2.node,
    LocationMutation.node,
    SessionStore.node,
  ],
})
