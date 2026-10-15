import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber } from "effect"
import { Database } from "@apexo/core/database/database"
import { ProjectV2 } from "@apexo/core/project"
import { ProjectTable } from "@apexo/core/project/sql"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSideQuestion } from "@apexo/core/session/side-question"
import { SessionTable } from "@apexo/core/session/sql"
import { SideQuestionTable } from "@apexo/core/side-question/sql"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionID } from "@apexo/schema/session-id"

const seed = (database: Database.Interface, sessionID = SessionID.create()) =>
  Effect.gen(function* () {
    const projectID = ProjectV2.ID.make("side-question-lifecycle")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/tmp"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "side",
        directory: "/tmp",
        title: "Side lifecycle",
        version: "1",
      })
      .run()
    return sessionID
  })

const fixture = Effect.gen(function* () {
  const database = yield* Database.Service
  const lifecycle = yield* SessionLifecycle.make
  const side = yield* SessionSideQuestion.make(database.db).pipe(
    Effect.provideService(SessionLifecycle.Service, lifecycle),
  )
  const sessionID = yield* seed(database)
  return { database, lifecycle, side, sessionID }
})

const closed = (lifecycle: SessionLifecycle.Interface, claim: SessionLifecycle.Claim): Effect.Effect<void> =>
  Effect.suspend(() =>
    lifecycle.available(claim) ? Effect.yieldNow.pipe(Effect.andThen(closed(lifecycle, claim))) : Effect.void,
  )

test(
  "retirement joins an active side question before cascade deletion and does not cancel a sibling",
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture
          const entered = yield* Deferred.make<void>()
          const stopping = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
          const siblingID = yield* seed(f.database)
          const sibling = yield* f.side.ask(siblingID, { question: "sibling" }, { model: "test", sample: Effect.never })
          yield* f.side.ask(
            f.sessionID,
            { question: "held" },
            {
              model: "test",
              sample: Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(stopping, undefined).pipe(Effect.andThen(Deferred.await(release)))),
              ),
            },
          )
          yield* Deferred.await(entered)
          const deletion = yield* f.lifecycle
            .retire(
              f.sessionID,
              f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.sessionID)).run().pipe(Effect.asVoid),
            )
            .pipe(Effect.forkChild)
          yield* Deferred.await(stopping).pipe(Effect.timeout("2 seconds"))
          expect(deletion.pollUnsafe()).toBeUndefined()
          expect(
            yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, f.sessionID)).get(),
          ).toBeDefined()
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(deletion)
          expect(
            yield* f.database.db
              .select()
              .from(SideQuestionTable)
              .where(eq(SideQuestionTable.session_id, f.sessionID))
              .all(),
          ).toEqual([])
          yield* seed(f.database, f.sessionID)
          expect(yield* f.side.list(f.sessionID)).toEqual([])
          expect((yield* f.side.list(siblingID))[0]?.status).toBe("running")
          expect((yield* f.side.cancel(siblingID, sibling.id)).status).toBe("cancelled")
        }),
      ).pipe(Effect.provide(Database.layerFromPath(":memory:"))),
    ),
  5000,
)

test(
  "list recovery is an admitted write and cannot reconcile rows after closing starts",
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture
          const now = Date.now()
          const entry = {
            id: "btw_orphan",
            sessionID: f.sessionID,
            question: "orphan",
            imageCount: 0,
            status: "running",
            answer: "",
            model: "test",
            createdAt: now,
            updatedAt: now,
          }
          yield* f.database.db
            .insert(SideQuestionTable)
            .values({ id: entry.id, session_id: f.sessionID, data: entry, time_created: now })
            .run()
          const claim = yield* f.lifecycle.capture(f.sessionID)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
          const write = yield* f.lifecycle
            .use(f.sessionID, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))
            .pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          const deletion = yield* f.lifecycle
            .retire(
              f.sessionID,
              f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.sessionID)).run().pipe(Effect.asVoid),
            )
            .pipe(Effect.forkChild)
          yield* closed(f.lifecycle, claim)
          const result = yield* f.side.list(f.sessionID).pipe(Effect.result)
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(result.failure).toMatchObject({ code: "missing" })
          expect(
            (yield* f.database.db.select().from(SideQuestionTable).where(eq(SideQuestionTable.id, entry.id)).get())
              ?.data,
          ).toEqual(entry)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(write)
          yield* Fiber.join(deletion)
        }),
      ).pipe(Effect.provide(Database.layerFromPath(":memory:"))),
    ),
  5000,
)

test("ordinary list durably reconciles orphan work once; deletion and exact ID reuse survive database reopen", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "apexo-side-reopen-"))
  try {
    const filename = path.join(directory, "state.sqlite")
    const sessionID = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture
          const now = Date.now()
          const entry = {
            id: "btw_restart",
            sessionID: f.sessionID,
            question: "old",
            imageCount: 0,
            status: "running",
            answer: "",
            model: "test",
            createdAt: now,
            updatedAt: now,
          }
          yield* f.database.db
            .insert(SideQuestionTable)
            .values({ id: entry.id, session_id: f.sessionID, data: entry, time_created: now })
            .run()
          const recovered = yield* f.side.list(f.sessionID)
          expect(recovered[0]?.status).toBe("cancelled")
          expect((yield* f.database.db.select().from(SideQuestionTable).get())?.data).toEqual(recovered[0])
          expect(yield* f.side.list(f.sessionID)).toEqual(recovered)
          yield* f.lifecycle.retire(
            f.sessionID,
            f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.sessionID)).run().pipe(Effect.asVoid),
          )
          yield* seed(f.database, f.sessionID)
          return f.sessionID
        }),
      ).pipe(Effect.provide(Database.layerFromPath(filename))),
    )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* Database.Service
          const lifecycle = yield* SessionLifecycle.make
          const side = yield* SessionSideQuestion.make(database.db).pipe(
            Effect.provideService(SessionLifecycle.Service, lifecycle),
          )
          expect(yield* side.list(sessionID)).toEqual([])
          expect(yield* database.db.select().from(SideQuestionTable).all()).toEqual([])
        }),
      ).pipe(Effect.provide(Database.layerFromPath(filename))),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
