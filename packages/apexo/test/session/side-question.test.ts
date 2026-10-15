import { expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionID } from "@apexo/schema/session-id"
import { Database } from "@apexo/core/database/database"
import { ProjectV2 } from "@apexo/core/project"
import { ProjectTable } from "@apexo/core/project/sql"
import { SessionLifecycle } from "@apexo/core/session/lifecycle"
import { SessionSideQuestion } from "@apexo/core/session/side-question"
import { SessionTable, MessageTable } from "@apexo/core/session/sql"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.merge(Database.layerFromPath(":memory:"), Layer.effect(SessionLifecycle.Service, SessionLifecycle.make)),
)

it.live("independent side questions persist separately and cancellation cannot stop a sibling", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const first = yield* f.store.ask(f.sessionID, { question: "first" }, { model: "test", sample: Effect.never })
    const ready = yield* Deferred.make<string>()
    const second = yield* f.store.ask(
      f.sessionID,
      { question: "second" },
      { model: "test", sample: Deferred.await(ready) },
    )
    expect((yield* f.store.list(f.sessionID)).map((entry) => entry.status)).toEqual(["running", "running"])
    expect((yield* f.store.cancel(f.sessionID, first.id)).status).toBe("cancelled")
    expect((yield* f.store.list(f.sessionID)).find((entry) => entry.id === second.id)?.status).toBe("running")
    yield* Deferred.succeed(ready, "Independent answer")
    yield* wait(f.store, f.sessionID)
    expect((yield* f.store.list(f.sessionID)).find((entry) => entry.id === second.id)).toMatchObject({
      status: "completed",
      answer: "Independent answer",
    })
    expect(yield* f.database.db.select().from(MessageTable).all()).toEqual([])
    expect(yield* (yield* SessionSideQuestion.make(f.database.db)).list(f.sessionID)).toHaveLength(2)
  }),
)

it.live("side question ownership, validation, and concurrent admission bounds are enforced", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const other = yield* fixture()
    const entries = yield* Effect.all(
      Array.from({ length: 5 }, (_, index) =>
        f.store
          .ask(f.sessionID, { question: `q${index}` }, { model: "test", sample: Effect.never })
          .pipe(Effect.result),
      ),
      { concurrency: "unbounded" },
    )
    expect(entries.filter((entry) => entry._tag === "Success")).toHaveLength(4)
    expect(entries.filter((entry) => entry._tag === "Failure")).toHaveLength(1)
    const first = (yield* f.store.list(f.sessionID))[0]!
    expect(yield* f.store.cancel(other.sessionID, first.id).pipe(Effect.flip)).toMatchObject({ code: "missing" })
    expect(
      yield* f.store
        .ask(other.sessionID, { question: " " }, { model: "test", sample: Effect.succeed("unused") })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect(
      yield* f.store
        .ask(
          other.sessionID,
          { question: "image", images: [{ mediaType: "image/png", data: "not-base64!" }] },
          { model: "test", sample: Effect.succeed("unused") },
        )
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
  }),
)

it.live("side question failures never persist provider credentials and empty answers fail", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.store.ask(
      f.sessionID,
      { question: "failure" },
      { model: "test", sample: Effect.fail(new Error("api_key=secret-token prompt=private")) },
    )
    yield* f.store.ask(f.sessionID, { question: "empty" }, { model: "test", sample: Effect.succeed(" ") })
    yield* wait(f.store, f.sessionID)
    const entries = yield* f.store.list(f.sessionID)
    expect(entries.map((entry) => entry.status)).toEqual(["failed", "failed"])
    expect(JSON.stringify(entries)).not.toContain("secret-token")
    expect(JSON.stringify(entries)).not.toContain("private")
  }),
)

function wait(
  store: Effect.Success<ReturnType<typeof SessionSideQuestion.make>>,
  id: SessionID,
): Effect.Effect<void, SessionSideQuestion.Error> {
  return Effect.gen(function* () {
    if ((yield* store.list(id)).every((entry) => entry.status !== "running")) return
    yield* Effect.sleep("10 millis")
    yield* wait(store, id)
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.catchTag("TimeoutError", () => Effect.die(new Error("Side question did not settle"))),
  )
}

const fixture = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const sessionID = SessionID.create()
  const projectID = ProjectV2.ID.make("side-question-test")
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
      slug: "btw",
      directory: "/tmp",
      title: "Side question",
      version: "1",
    })
    .run()
  return { database, sessionID, store: yield* SessionSideQuestion.make(database.db) }
})
