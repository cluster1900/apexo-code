import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "@apexo/core/database/database"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { MemoryContext } from "@apexo/core/memory-context"
import { Global } from "@apexo/core/global"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { MemoryTopicReads } from "@apexo/core/memory-topic-reads"
import { MemoryV2Catalog } from "@apexo/core/memory-v2-catalog"
import { SessionMemoryContextTable } from "@apexo/core/session/sql"
import { SessionV1 } from "@apexo/core/v1/session"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { MemoryIndex } from "./memory-index"
import { Session } from "./session"
import { SessionID } from "./schema"
import { SessionMemoryMode } from "./memory-mode"
import { SessionMemoryBackend } from "./memory-backend"

export interface Interface {
  readonly recordRead: (input: { sessionID: SessionID; path: string; agent: Agent.Info }) => Effect.Effect<void>
  readonly context: (input: {
    sessionID: SessionID
    messages: SessionV1.WithParts[]
    agent: Agent.Info
  }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/SessionMemoryContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const sessions = yield* Session.Service
    const index = yield* MemoryIndex.Service
    const database = yield* Database.Service
    const global = yield* Global.Service
    const mode = yield* SessionMemoryMode.Service
    const backend = yield* SessionMemoryBackend.Service
    const attempts = yield* InstanceState.make(() => Effect.succeed(new Set<string>()))

    const v2context = Effect.fn("SessionMemoryContext.v2")(function* (input: Parameters<Interface["context"]>[0]) {
      return yield* mode.run(input.sessionID, (modeRevision) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const session = yield* sessions.get(input.sessionID)
          const summary = input.messages
            .filter(
              (message) =>
                message.info.role === "assistant" && message.info.summary && message.info.finish && !message.info.error,
            )
            .at(-1)
          const location = {
            home: global.home,
            compactIndex: (yield* config.get()).memory_v2?.compact_index_enabled,
            directory: ctx.directory,
            projectID: ctx.project.id,
            permitted: (paths: readonly string[], action: "read" | "edit") =>
              paths.every(
                (file) =>
                  Permission.evaluate(action, file, input.agent.permission, session.permission ?? []).action ===
                  "allow",
              ),
          }
          const revision = yield* MemoryV2Catalog.context(location, [])
          const epoch = `v2:${summary?.info.id ?? "initial"}:${modeRevision}:${revision.generation}`
          const where = and(
            eq(SessionMemoryContextTable.session_id, input.sessionID),
            eq(SessionMemoryContextTable.epoch, epoch),
          )
          const saved = yield* database.db.select().from(SessionMemoryContextTable).where(where).get()
          if (saved) {
            const current = yield* MemoryV2Catalog.context(location, saved.access_paths)
            return current.generation === revision.generation ? saved.content : ""
          }
          const attempted = yield* InstanceState.get(attempts)
          const key = `${input.sessionID}:${epoch}`
          if (attempted.has(key)) return ""
          attempted.add(key)
          const snapshot = yield* mode.commit(input.sessionID, modeRevision, MemoryV2Catalog.context(location))
          if (!snapshot.content || snapshot.generation !== revision.generation) return ""
          yield* database.db
            .insert(SessionMemoryContextTable)
            .values({
              session_id: input.sessionID,
              epoch,
              content: snapshot.content,
              access_paths: snapshot.access_paths,
            })
            .onConflictDoNothing()
          const current = yield* MemoryV2Catalog.context(location, snapshot.access_paths)
          if (current.generation !== revision.generation) {
            yield* database.db.delete(SessionMemoryContextTable).where(where)
            return ""
          }
          return (yield* database.db.select().from(SessionMemoryContextTable).where(where).get())?.content ?? ""
        }),
      )
    })

    const context = Effect.fn("SessionMemoryContext.context")(
      function* (input: Parameters<Interface["context"]>[0]) {
        if (flags.runtimeProfile !== "grok-build") return ""
        const policy = yield* backend.get(input.sessionID)
        if (policy.backend === "v2") return policy.expose ? yield* v2context(input) : ""
        const settings = (yield* config.get()).memory
        return yield* mode.run(input.sessionID, (modeRevision) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(input.sessionID)
            const summary = input.messages
              .filter(
                (message) =>
                  message.info.role === "assistant" &&
                  message.info.summary &&
                  message.info.finish &&
                  !message.info.error,
              )
              .toSorted((a, b) => (a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0))
              .at(-1)
            if (!summary && settings?.initial_injection?.enabled === false) return ""
            const ctx = yield* InstanceState.context
            const revision = Effect.promise(() =>
              Promise.all(
                (["global", "workspace"] as const).map((scope) =>
                  MemoryMaintenance.revision(
                    WorkspaceMemory.maintenance(ctx.directory, global.home, { projectID: ctx.project.id, scope }),
                  ),
                ),
              ),
            )
            const generations = yield* revision
            const unchanged = revision.pipe(Effect.map((current) => current.join(":") === generations.join(":")))
            const epoch = `${summary?.info.id ?? "initial"}${modeRevision === "initial" ? "" : `:${modeRevision}`}${generations.every((item) => item === "initial") ? "" : `:${generations.join(":")}`}`
            const where = and(
              eq(SessionMemoryContextTable.session_id, input.sessionID),
              eq(SessionMemoryContextTable.epoch, epoch),
            )
            const permitted = (paths: readonly string[], permission = "read") =>
              paths.every(
                (file) =>
                  Permission.evaluate(permission, file, input.agent.permission, session.permission ?? []).action ===
                  "allow",
              )
            const saved = yield* database.db.select().from(SessionMemoryContextTable).where(where).get()
            if (saved) return permitted(saved.access_paths) && (yield* unchanged) ? saved.content : ""
            const attempted = yield* InstanceState.get(attempts)
            const key = `${input.sessionID}:${epoch}`
            if (attempted.has(key)) return ""
            attempted.add(key)

            const snapshot = yield* Effect.gen(function* () {
              const ctx = yield* InstanceState.context
              yield* Effect.promise(() =>
                WorkspaceMemory.migrate(
                  ctx.directory,
                  global.home,
                  { projectID: ctx.project.id },
                  (paths) => permitted(paths.read) && permitted(paths.edit, "edit"),
                ),
              )
              const memory = yield* index.get()
              // Compaction may retain no real user text. Recover the query from durable history,
              // excluding synthetic continuations and tool/assistant text in either path.
              const history = summary
                ? (yield* sessions.messages({ sessionID: input.sessionID })).filter(
                    (message) => message.info.id < summary.info.id,
                  )
                : input.messages
              const found = yield* memory.search(
                {
                  query: MemoryContext.query(history, !!summary),
                  max_results: summary ? 3 : 6,
                  min_score: summary ? 0 : (settings?.initial_injection?.min_score ?? 0.9),
                },
                (paths) =>
                  permitted(memory.accessPaths(paths))
                    ? Effect.void
                    : Effect.die(new Error("Automatic memory access is not allowed")),
              )
              const results = summary
                ? found.results
                : found.results.filter((result) => result.score.toFixed(2) !== "0.00")
              return {
                content: MemoryContext.format(results),
                access_paths: memory.accessPaths(results.map((result) => result.path)),
              }
            }).pipe(Effect.catchCause(() => Effect.succeed({ content: "", access_paths: [] as string[] })))

            // Empty attempts last for this instance only, matching a runtime's injection
            // flag. A resumed session without a persisted block gets another search.
            if (!snapshot.content || !(yield* unchanged)) return ""
            yield* database.db
              .insert(SessionMemoryContextTable)
              .values({
                session_id: input.sessionID,
                epoch,
                ...snapshot,
              })
              .onConflictDoNothing()
            const stored = yield* database.db.select().from(SessionMemoryContextTable).where(where).get()
            if (!(yield* unchanged)) {
              yield* database.db.delete(SessionMemoryContextTable).where(where)
              return ""
            }
            return stored && permitted(stored.access_paths) ? stored.content : ""
          }),
        )
      },
      Effect.catchTag("SessionMemoryDisabled", () => Effect.succeed("")),
      Effect.catchCause(() =>
        Effect.logWarning("Could not load or persist session memory context").pipe(Effect.as("")),
      ),
    )

    const recordRead = Effect.fn("SessionMemoryContext.recordRead")(
      function* (input: Parameters<Interface["recordRead"]>[0]) {
        if (flags.runtimeProfile !== "grok-build") return
        const policy = yield* backend.get(input.sessionID)
        if (policy.backend !== "v2" || !policy.expose) return
        yield* mode.run(input.sessionID, (revision) =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID)
            yield* mode.commit(
              input.sessionID,
              revision,
              MemoryTopicReads.record(
                {
                  home: global.home,
                  directory: ctx.directory,
                  projectID: ctx.project.id,
                  permitted: (paths, action) =>
                    paths.every(
                      (file) =>
                        Permission.evaluate(action, file, input.agent.permission, session.permission ?? []).action ===
                        "allow",
                    ),
                },
                input.path,
              ),
            )
          }),
        )
      },
      Effect.catchCause(() => Effect.void),
    )
    return Service.of({ context, recordRead })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Config.node,
    RuntimeFlags.node,
    Session.node,
    MemoryIndex.node,
    Database.node,
    Global.node,
    SessionMemoryMode.node,
    SessionMemoryBackend.node,
  ],
})

export * as SessionMemoryContext from "./memory-context"
