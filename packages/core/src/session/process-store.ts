export * as SessionProcessStore from "./process-store"

import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { SessionProcess } from "@apexo/schema/session-process"
import { NonNegativeInt, optional } from "@apexo/schema/schema"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionIncarnation } from "./incarnation"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionProcessTable } from "./process.sql"

export const MAX_OUTPUT_BYTES = 1024 * 1024
export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionProcessFailure", {
  code: Schema.Literals(["missing", "busy", "invalid", "restart", "storage", "stale"]),
  message: Schema.String,
}) {}
export const Request = Schema.Struct({
  agent: AgentV2.ID,
  command: Schema.String,
  cwd: Schema.String,
  shell: Schema.String,
  description: Schema.String,
  waitMs: NonNegativeInt,
  timeoutMs: NonNegativeInt,
  monitor: optional(Schema.Struct({ persistent: Schema.Boolean })),
})
export type Request = typeof Request.Type
export const Record = Schema.Struct({
  ...SessionProcess.Detail.fields,
  owner: Schema.String,
  spawned: Schema.Boolean,
  sessionCreated: Schema.String,
  invocation: Schema.String,
  request: Request,
  notice: optional(Schema.Literals(["pending", "delivered", "observed", "suppressed"])),
})
export type Record = typeof Record.Type

export function make(db: Database.Interface["db"]) {
  const owner = randomUUID()
  const storage = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof Failure
          ? error
          : new Failure({ code: "storage", message: "Shell process state is unavailable" }),
      ),
    )
  const read = (id: SessionProcess.ID) =>
    storage(
      Effect.gen(function* () {
        const row = yield* db.select().from(SessionProcessTable).where(eq(SessionProcessTable.id, id)).get()
        if (!row) return undefined
        const record = yield* Schema.decodeUnknownEffect(Record)(row.data)
        if (record.id !== row.id || record.sessionID !== row.session_id || record.invocation !== row.invocation)
          return yield* new Failure({ code: "storage", message: "Shell process ownership is invalid" })
        return record
      }),
    )
  const owned = (sessionID: SessionSchema.ID, id: SessionProcess.ID) =>
    storage(
      Effect.gen(function* () {
        const record = yield* read(id)
        if (!record || record.sessionID !== sessionID)
          return yield* new Failure({ code: "missing", message: "Shell process does not belong to this Session" })
        if (record.sessionCreated !== (yield* SessionIncarnation.created(db, sessionID)))
          return yield* new Failure({
            code: "stale",
            message: "Shell process no longer belongs to this Session incarnation",
          })
        return record
      }),
    )
  const change = <A>(
    sessionID: SessionSchema.ID,
    id: SessionProcess.ID,
    update: (record: Record) => { record: Record; value: A },
  ) =>
    storage(
      db.transaction(
        () =>
          Effect.gen(function* () {
            const previous = yield* owned(sessionID, id)
            if (previous.owner !== owner)
              return yield* new Failure({ code: "restart", message: "Shell process cannot be continued after restart" })
            const next = update(previous)
            if (next.record !== previous)
              yield* db.update(SessionProcessTable).set({ data: next.record }).where(eq(SessionProcessTable.id, id))
            return next.value
          }),
        { behavior: "immediate" },
      ),
    )
  const detail = (record: Record): SessionProcess.Detail => ({
    id: record.id,
    sessionID: record.sessionID,
    kind: record.kind,
    ...(record.monitor ? { monitor: record.monitor } : {}),
    description: record.description,
    status: record.status === "running" && record.owner !== owner ? "interrupted" : record.status,
    background: record.background,
    startedAt: record.startedAt,
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    ...(record.status === "running" && record.owner !== owner ? { blockedReason: "process_restart" as const } : {}),
    truncated: record.truncated,
    output: record.output,
  })
  return {
    owner,
    read,
    owned,
    detail,
    begin: (input: { sessionID: SessionSchema.ID; messageID: SessionMessage.ID; callID: string; request: Request }) =>
      storage(
        db.transaction(
          () =>
            Effect.gen(function* () {
              const sessionCreated = yield* SessionIncarnation.created(db, input.sessionID)
              if (!sessionCreated)
                return yield* new Failure({ code: "missing", message: "Shell process Session does not exist" })
              const invocation = JSON.stringify([input.messageID, input.callID])
              const row = yield* db
                .select()
                .from(SessionProcessTable)
                .where(
                  and(
                    eq(SessionProcessTable.session_id, input.sessionID),
                    eq(SessionProcessTable.invocation, invocation),
                  ),
                )
                .get()
              if (row) {
                const previous = yield* owned(input.sessionID, row.id)
                if (
                  previous.request.monitor?.persistent !== input.request.monitor?.persistent ||
                  previous.request.agent !== input.request.agent ||
                  previous.request.command !== input.request.command ||
                  previous.request.cwd !== input.request.cwd ||
                  previous.request.shell !== input.request.shell ||
                  previous.request.description !== input.request.description ||
                  previous.request.waitMs !== input.request.waitMs ||
                  previous.request.timeoutMs !== input.request.timeoutMs
                )
                  return yield* new Failure({
                    code: "invalid",
                    message: "Shell invocation was reused with different arguments",
                  })
                if (previous.status === "running" && previous.owner !== owner)
                  return yield* new Failure({
                    code: "restart",
                    message: "Shell process cannot be restarted from an unfinished receipt",
                  })
                return { record: previous, created: false }
              }
              const record: Record = {
                id: SessionProcess.ID.create(),
                sessionID: input.sessionID,
                kind: input.request.monitor ? "monitor" : "shell",
                ...(input.request.monitor
                  ? {
                      monitor: {
                        persistent: input.request.monitor.persistent,
                        timeoutMs: input.request.timeoutMs,
                        accepted: 0,
                        suppressed: 0,
                        overloaded: false,
                      },
                    }
                  : {}),
                description: input.request.description,
                status: "running",
                background: input.request.waitMs === 0,
                startedAt: Date.now(),
                truncated: false,
                output: "",
                owner,
                spawned: false,
                sessionCreated,
                invocation,
                request: input.request,
              }
              yield* db.insert(SessionProcessTable).values({
                id: record.id,
                session_id: record.sessionID,
                invocation,
                data: record,
                time_created: record.startedAt,
              })
              return { record, created: true }
            }),
          { behavior: "immediate" },
        ),
      ),
    list: (sessionID: SessionSchema.ID, limit = 50) =>
      storage(
        Effect.gen(function* () {
          const created = yield* SessionIncarnation.created(db, sessionID)
          if (!created) return yield* new Failure({ code: "missing", message: "Shell process Session does not exist" })
          const rows = yield* db
            .select()
            .from(SessionProcessTable)
            .where(eq(SessionProcessTable.session_id, sessionID))
            .orderBy(desc(SessionProcessTable.time_created), desc(SessionProcessTable.id))
            .limit(Math.max(1, Math.min(limit, 100)))
          const records = yield* Effect.forEach(rows, (row) => owned(sessionID, row.id))
          return records
            .filter((record) => record.spawned || record.status !== "running" || record.owner !== owner)
            .map(detail)
        }),
      ),
    output: (sessionID: SessionSchema.ID, id: SessionProcess.ID) => owned(sessionID, id).pipe(Effect.map(detail)),
    started: (sessionID: SessionSchema.ID, id: SessionProcess.ID) =>
      change(sessionID, id, (previous) => {
        const record =
          previous.status === "running" && !previous.spawned
            ? { ...previous, spawned: true, startedAt: Date.now() }
            : previous
        return { record, value: record }
      }),
    snapshot: (sessionID: SessionSchema.ID, id: SessionProcess.ID, output: string, truncated: boolean) => {
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES)
        return Effect.fail(new Failure({ code: "invalid", message: "Shell process output exceeds its capture limit" }))
      return change(sessionID, id, (previous) => ({
        record: previous.status === "running" ? { ...previous, output, truncated } : previous,
        value: undefined,
      }))
    },
    monitor: (
      sessionID: SessionSchema.ID,
      id: SessionProcess.ID,
      stats: Pick<SessionProcess.Monitor, "accepted" | "suppressed" | "overloaded">,
    ) =>
      change(sessionID, id, (previous) => ({
        record:
          previous.status === "running" && previous.monitor
            ? { ...previous, monitor: { ...previous.monitor, ...stats } }
            : previous,
        value: undefined,
      })),
    promote: (sessionID: SessionSchema.ID, id: SessionProcess.ID) =>
      change(sessionID, id, (previous) => {
        const record = previous.status === "running" ? { ...previous, background: true } : previous
        return { record, value: record }
      }),
    finish: (
      sessionID: SessionSchema.ID,
      id: SessionProcess.ID,
      input: { status: "completed" | "failed" | "cancelled"; exitCode?: number; output: string; truncated: boolean },
    ) => {
      if (Buffer.byteLength(input.output) > MAX_OUTPUT_BYTES)
        return Effect.fail(new Failure({ code: "invalid", message: "Shell process output exceeds its capture limit" }))
      return change(sessionID, id, (previous) => {
        const record =
          previous.status === "running"
            ? {
                ...previous,
                ...input,
                completedAt: Date.now(),
                ...(input.status === "cancelled" ? { notice: "suppressed" as const } : {}),
              }
            : previous
        return { record, value: record }
      })
    },
    notice: (sessionID: SessionSchema.ID, id: SessionProcess.ID, notice: NonNullable<Record["notice"]>) =>
      change(sessionID, id, (previous) => {
        if (
          previous.status === "running" ||
          previous.status === "cancelled" ||
          !previous.spawned ||
          !previous.background ||
          (notice === "pending"
            ? previous.notice !== undefined
            : previous.notice !== undefined && previous.notice !== "pending")
        )
          return { record: previous, value: false }
        return { record: { ...previous, notice }, value: true }
      }),
  }
}
export type Interface = ReturnType<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionProcessStore") {}
export const node = makeGlobalNode({
  service: Service,
  deps: [Database.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const database = yield* Database.Service
      return make(database.db)
    }),
  ),
})
