export * as SessionSideQuestion from "./side-question"

import { randomUUID } from "node:crypto"
import { and, asc, eq } from "drizzle-orm"
import { Clock, Context, Deferred, Effect, Fiber, FiberSet, Layer, Schema, Semaphore } from "effect"
import { SideQuestion } from "@apexo/schema/side-question"
import { SessionID } from "@apexo/schema/session-id"
import { Database } from "../database/database"
import { SideQuestionTable } from "../side-question/sql"
import { SessionLifecycle } from "./lifecycle"
import { SessionTable } from "./sql"
import { makeGlobalNode } from "../effect/app-node"

export class Error extends Schema.TaggedErrorClass<Error>()("SideQuestionError", {
  code: Schema.Literals(["missing", "invalid", "capacity", "storage"]),
  message: Schema.String,
}) {}

/** Sampling adapters capture a policy-checked context before handing work to this separate lane. */
export type Snapshot = { model: string; sample: Effect.Effect<string, unknown> }

export const make = Effect.fnUntraced(function* (db: Database.Interface["db"]) {
  const lifecycle = yield* SessionLifecycle.Service
  const gate = Semaphore.makeUnsafe(1).withPermit
  const active = new Map<string, Fiber.Fiber<void>>()
  const fork = yield* FiberSet.makeRuntime<never, void, never>()
  const boundary = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof SessionLifecycle.Closed
          ? new Error({ code: "missing", message: "Session not found" })
          : error instanceof Error
            ? error
            : new Error({ code: "storage", message: "Side question storage is unavailable" }),
      ),
    )
  const requireSession = Effect.fnUntraced(function* (sessionID: SessionID) {
    if (!(yield* db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get()))
      return yield* new Error({ code: "missing", message: "Session not found" })
  })
  const update = (entry: SideQuestion.Entry) =>
    db
      .update(SideQuestionTable)
      .set({ data: entry })
      .where(and(eq(SideQuestionTable.id, entry.id), eq(SideQuestionTable.session_id, entry.sessionID)))
      .run()
  const read = (sessionID: SessionID) =>
    boundary(
      Effect.gen(function* () {
        yield* requireSession(sessionID)
        const rows = yield* db
          .select()
          .from(SideQuestionTable)
          .where(eq(SideQuestionTable.session_id, sessionID))
          .orderBy(asc(SideQuestionTable.time_created), asc(SideQuestionTable.id))
          .all()
        return yield* Effect.forEach(rows, (row) =>
          Effect.gen(function* () {
            const entry = yield* Schema.decodeUnknownEffect(SideQuestion.Entry)(row.data)
            if (entry.id !== row.id || entry.sessionID !== sessionID)
              return yield* new Error({ code: "storage", message: "Side question ownership is invalid" })
            // A process restart never retries provider work automatically.
            if (entry.status !== "running" || active.has(entry.id)) return entry
            const interrupted: SideQuestion.Entry = {
              ...entry,
              status: "cancelled",
              error: "The process stopped before this answer completed",
              updatedAt: yield* Clock.currentTimeMillis,
            }
            yield* update(interrupted)
            return interrupted
          }),
        )
      }),
    )
  const ask = (sessionID: SessionID, input: SideQuestion.Input, snapshot: Snapshot) =>
    boundary(
      lifecycle.use(
        sessionID,
        gate(
          Effect.gen(function* () {
            yield* Schema.decodeUnknownEffect(SideQuestion.Input)(input).pipe(
              Effect.mapError(() => new Error({ code: "invalid", message: "Invalid side question" })),
            )
            if (!input.question.trim() || Buffer.byteLength(input.question) > 65_536)
              return yield* new Error({ code: "invalid", message: "The side question must not be blank" })
            yield* Effect.try({
              try: () => validateImages(input),
              catch: () =>
                new Error({ code: "invalid", message: "Images must be valid base64 and total at most 50 MB" }),
            })
            const entries = yield* read(sessionID)
            if (entries.length >= 1000 || entries.filter((entry) => entry.status === "running").length >= 4)
              return yield* new Error({ code: "capacity", message: "This session has reached its side question limit" })
            const now = yield* Clock.currentTimeMillis
            const entry: SideQuestion.Entry = {
              id: `btw_${randomUUID()}`,
              sessionID,
              question: input.question,
              imageCount: input.images?.length ?? 0,
              status: "running",
              answer: "",
              model: snapshot.model,
              createdAt: now,
              updatedAt: now,
            }
            yield* db
              .insert(SideQuestionTable)
              .values({ id: entry.id, session_id: sessionID, data: entry, time_created: now })
              .run()
            const claim = yield* lifecycle.capture(sessionID)
            yield* Effect.uninterruptibleMask(() =>
              Effect.gen(function* () {
                const ready = Deferred.makeUnsafe<void>()
                const registration = { release: () => {} }
                // The worker cannot sample until its cancellation owner is registered.
                const fiber = fork(
                  lifecycle.owned(
                    claim,
                    Effect.interruptible(
                      Deferred.await(ready).pipe(
                        Effect.andThen(snapshot.sample),
                        Effect.timeout("120 seconds"),
                        Effect.flatMap((answer) =>
                          answer.trim() && Buffer.byteLength(answer) <= 1_048_576
                            ? Effect.succeed(answer)
                            : Effect.fail(
                                new Error({
                                  code: "invalid",
                                  message: "The model returned an empty or oversized answer",
                                }),
                              ),
                        ),
                        Effect.matchEffect({
                          onSuccess: (answer) =>
                            Effect.gen(function* () {
                              yield* update({
                                ...entry,
                                status: "completed",
                                answer,
                                updatedAt: yield* Clock.currentTimeMillis,
                              })
                            }),
                          // Do not persist provider errors: they can contain URLs, credentials, or prompt bodies.
                          onFailure: () =>
                            Effect.gen(function* () {
                              yield* update({
                                ...entry,
                                status: "failed",
                                error: "The side question could not be answered. Try again.",
                                updatedAt: yield* Clock.currentTimeMillis,
                              })
                            }),
                        }),
                        Effect.onInterrupt(() =>
                          Effect.gen(function* () {
                            yield* update({ ...entry, status: "cancelled", updatedAt: yield* Clock.currentTimeMillis })
                          }).pipe(Effect.ignore),
                        ),
                        Effect.ensuring(
                          Effect.sync(() => {
                            active.delete(entry.id)
                            registration.release()
                          }),
                        ),
                        Effect.ignore,
                      ),
                    ),
                  ),
                )
                active.set(entry.id, fiber)
                registration.release = yield* lifecycle
                  .register(claim, fiber, Fiber.interrupt(fiber))
                  .pipe(Effect.onError(() => Fiber.interrupt(fiber)))
                yield* Deferred.succeed(ready, undefined)
              }),
            )
            return entry
          }),
        ),
      ),
    )
  const cancel = (sessionID: SessionID, id: string) =>
    boundary(
      lifecycle.read(
        sessionID,
        Effect.gen(function* () {
          const entry = (yield* lifecycle.use(sessionID, gate(read(sessionID)))).find((entry) => entry.id === id)
          if (!entry) return yield* new Error({ code: "missing", message: "Side question not found in this session" })
          const fiber = active.get(id)
          if (fiber) yield* Fiber.interrupt(fiber)
          return (yield* lifecycle.use(sessionID, gate(read(sessionID)))).find((entry) => entry.id === id)!
        }),
      ),
    )
  const list = (sessionID: SessionID) => boundary(lifecycle.use(sessionID, gate(read(sessionID))))
  return { list, ask, cancel }
})

export function validateImages(input: SideQuestion.Input) {
  const size = (input.images ?? []).reduce((total, image) => {
    if (!image.data.length || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))
      throw new globalThis.Error("Invalid image encoding")
    return total + Buffer.byteLength(image.data, "base64")
  }, 0)
  if (size > 50_000_000) throw new globalThis.Error("Image input exceeds 50 MB")
}

export type Interface = Effect.Success<ReturnType<typeof make>>
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionSideQuestion") {}
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    return yield* make(database.db)
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, SessionLifecycle.node] })
