import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Feedback } from "@apexo/schema/feedback"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionID } from "@apexo/schema/session-id"
import { Database } from "@apexo/core/database/database"
import { FeedbackDraftTable, FeedbackImageTable } from "@apexo/core/feedback/sql"
import { ProjectV2 } from "@apexo/core/project"
import { ProjectTable } from "@apexo/core/project/sql"
import { SessionFeedback } from "@apexo/core/session/feedback"
import { SessionTable } from "@apexo/core/session/sql"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))
const input: Feedback.Input = {
  title: "Incorrect result",
  details: "What happened:\nA tool failed.\n\nRepro:\nRun the tool.",
  type: "bug",
}

it.live("feedback drafts persist, replace exactly, strip tool IDs and remain scoped to their session", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const draft = yield* f.store.save(f.sessionID, input)
    expect(draft.revision).toBe(1)
    expect(yield* SessionFeedback.make(f.database.db).list(f.sessionID)).toEqual([draft])
    const updated = yield* f.store.save(f.sessionID, {
      ...input,
      draft_id: ` ${draft.id} `,
      title: `Bug ${draft.id}`,
      details: `Repro\n${draft.id}\n\nStill fails`,
      product_area: draft.id,
    })
    expect(updated).toMatchObject({
      id: draft.id,
      revision: 2,
      createdAt: draft.createdAt,
      title: "Bug ",
      details: "Repro\n\nStill fails",
      product_area: "",
    })
    expect(yield* f.store.list(f.sessionID)).toEqual([updated])
    const other = yield* fixture()
    expect(yield* f.store.save(other.sessionID, { ...input, draft_id: draft.id }).pipe(Effect.flip)).toMatchObject({
      code: "missing",
    })
    expect(yield* f.store.list(other.sessionID)).toEqual([])
  }),
)

it.live("review and deletion reject stale revisions and issue preparation neither sends nor removes a draft", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const draft = yield* f.store.save(f.sessionID, { ...input, task_category: "debug", failure_mode: "sloppy_code" })
    const reviewed = yield* f.store.review(f.sessionID, draft.id, 1)
    expect(reviewed.draft).toEqual(draft)
    expect(new URL(reviewed.url).origin).toBe("https://github.com")
    expect(new URL(reviewed.url).searchParams.get("body")).toContain("Failure mode: sloppy_code")
    expect(reviewed.body).not.toContain(f.sessionID)
    expect(reviewed.body).not.toContain(draft.id)
    expect(yield* f.store.list(f.sessionID)).toEqual([draft])
    yield* f.store.save(f.sessionID, { ...input, draft_id: draft.id, revision: 1 })
    expect(yield* f.store.review(f.sessionID, draft.id, 1).pipe(Effect.flip)).toMatchObject({ code: "conflict" })
    expect(yield* f.store.remove(f.sessionID, draft.id, 1).pipe(Effect.flip)).toMatchObject({ code: "conflict" })
    expect(yield* f.store.remove(f.sessionID, draft.id, 2)).toBe(true)
    expect(yield* f.store.remove(f.sessionID, draft.id, 2)).toBe(false)
  }),
)

it.live("concurrent edits with the same reviewed revision cannot overwrite each other", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const draft = yield* f.store.save(f.sessionID, input)
    const results = yield* Effect.all(
      ["first", "second"].map((title) =>
        f.store
          .save(f.sessionID, {
            ...input,
            title,
            draft_id: draft.id,
            revision: 1,
          })
          .pipe(Effect.result),
      ),
      { concurrency: "unbounded" },
    )
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1)
    expect((yield* f.store.list(f.sessionID))[0]?.revision).toBe(2)
  }),
)

it.live("feedback validation bounds UTF-8 bytes and rejects blanks after removing draft IDs", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const draft = yield* f.store.save(f.sessionID, { ...input, details: "é".repeat(32_768) })
    expect(Buffer.byteLength(draft.details)).toBe(65_536)
    for (const bad of [
      { ...input, title: " \n " },
      { ...input, details: "é".repeat(32_769) },
      { ...input, product_area: "界".repeat(22_000) },
      { ...input, draft_id: draft.id, details: draft.id },
    ])
      expect(yield* f.store.save(f.sessionID, bad).pipe(Effect.flip)).toMatchObject({ code: "invalid" })
    expect(yield* f.store.list(f.sessionID)).toEqual([draft])
    const reviewed = yield* f.store.review(f.sessionID, draft.id, 1)
    expect(reviewed.url).toBe("https://github.com/cluster1900/apexo-grok/issues/new")
    expect(reviewed.body).toContain(draft.details)
  }),
)

it.live("deleting the owning session cascades its drafts without touching another session", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const other = yield* fixture()
    const own = yield* f.store.save(f.sessionID, input)
    const keep = yield* f.store.save(other.sessionID, input)
    yield* f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.sessionID)).run()
    expect(
      yield* f.database.db.select().from(FeedbackDraftTable).where(eq(FeedbackDraftTable.id, own.id)).get(),
    ).toBeUndefined()
    expect(yield* f.store.list(other.sessionID)).toEqual([keep])
    expect(yield* f.store.save(f.sessionID, input).pipe(Effect.flip)).toMatchObject({ code: "missing" })
  }),
)

it.live("corrupt stored draft ownership fails closed instead of exposing another session", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const draft = yield* f.store.save(f.sessionID, input)
    yield* f.database.db
      .update(FeedbackDraftTable)
      .set({ data: { ...draft, sessionID: SessionID.create() } })
      .where(eq(FeedbackDraftTable.id, draft.id))
      .run()
    expect(yield* f.store.list(f.sessionID).pipe(Effect.flip)).toMatchObject({ code: "storage" })
  }),
)

it.live("feedback capacity permits an edit at the draft-count limit but rejects additional drafts", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.database.db
      .insert(FeedbackDraftTable)
      .values(
        Array.from({ length: 1000 }, (_, index) => ({
          id: `feedback_${index}`,
          session_id: f.sessionID,
          time_created: index,
          data: {
            ...input,
            id: `feedback_${index}`,
            sessionID: f.sessionID,
            revision: 1,
            createdAt: index,
            updatedAt: index,
          },
        })),
      )
      .run()
    expect(yield* f.store.save(f.sessionID, input).pipe(Effect.flip)).toMatchObject({ code: "capacity" })
    expect((yield* f.store.save(f.sessionID, { ...input, draft_id: "feedback_0", revision: 1 })).revision).toBe(2)
    expect(yield* f.store.list(f.sessionID)).toHaveLength(1000)
  }),
)

it.live("feedback document byte limit rejects an oversized replacement without changing its revision", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.database.db
      .insert(FeedbackDraftTable)
      .values(
        Array.from({ length: 128 }, (_, index) => ({
          id: `feedback_${index}`,
          session_id: f.sessionID,
          time_created: index,
          data: {
            ...input,
            details: "x".repeat(65_000),
            id: `feedback_${index}`,
            sessionID: f.sessionID,
            revision: 1,
            createdAt: index,
            updatedAt: index,
          },
        })),
      )
      .run()
    expect(
      yield* f.store
        .save(f.sessionID, {
          ...input,
          draft_id: "feedback_0",
          details: "x".repeat(65_536),
          product_area: "x".repeat(65_536),
        })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "capacity" })
    expect((yield* f.store.list(f.sessionID))[0]?.revision).toBe(1)
  }),
)

const images: Feedback.ImageSnapshot[] = [
  {
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC",
    mimeType: "image/png",
    fileName: "screen.png",
  },
  {
    data: "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/HOiiiv9/D8rP//Z",
    mimeType: "image/jpeg",
    fileName: "screen.jpg",
  },
  { data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", mimeType: "image/gif", fileName: "screen.gif" },
]

it.live("feedback snapshots validate formats, retain tool edits and reject foreign or stale image reads", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const draft = yield* f.store.save(f.sessionID, { ...input, details: "", images })
    expect(draft.images).toHaveLength(3)
    expect(JSON.stringify(yield* f.store.list(f.sessionID))).not.toContain(images[0]!.data)
    for (const [index, image] of draft.images!.entries()) {
      expect((yield* f.store.image(f.sessionID, draft.id, draft.revision, image.id)).data).toBe(images[index]!.data)
    }
    const review = yield* f.store.review(f.sessionID, draft.id, 1)
    expect(review.url).not.toContain("base64")
    expect(review.url).not.toContain("screen.png")
    const other = yield* fixture()
    expect(yield* f.store.image(other.sessionID, draft.id, 1, draft.images![0]!.id).pipe(Effect.flip)).toMatchObject({
      code: "missing",
    })
    expect(
      yield* f.store.save(other.sessionID, { ...input, images: [{ id: draft.images![0]!.id }] }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect(
      yield* f.store.save(f.sessionID, { ...input, draft_id: draft.id, images: [] }).pipe(Effect.flip),
    ).toMatchObject({ code: "conflict" })
    const updated = yield* f.store.saveText(f.sessionID, { ...input, draft_id: draft.id, revision: 1 })
    expect(updated.images).toEqual(draft.images)
    expect(yield* f.store.image(f.sessionID, draft.id, 1, draft.images![0]!.id).pipe(Effect.flip)).toMatchObject({
      code: "conflict",
    })
    expect(
      yield* f.store.saveText(f.sessionID, { ...input, details: "", draft_id: draft.id }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    const kept = yield* f.store.save(f.sessionID, {
      ...input,
      draft_id: draft.id,
      revision: 2,
      images: [{ id: draft.images![1]!.id }],
    })
    expect(kept.images).toEqual([draft.images![1]!])
    expect(yield* f.store.image(f.sessionID, draft.id, 3, draft.images![0]!.id).pipe(Effect.flip)).toMatchObject({
      code: "missing",
    })
    const removed = yield* f.store.save(f.sessionID, { ...input, draft_id: draft.id, revision: 3, images: [] })
    expect(removed.images).toEqual([])
    expect(
      yield* f.database.db.select().from(FeedbackImageTable).where(eq(FeedbackImageTable.draft_id, draft.id)).all(),
    ).toEqual([])
  }),
)

it.live("feedback image rejects bad base64, bytes, MIME, filenames and count without mutation", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    for (const bad of [
      { ...images[0]!, data: "not-base64" },
      { ...images[0]!, data: Buffer.from("not an image").toString("base64") },
      { ...images[0]!, data: images[0]!.data.slice(0, 32) },
      { ...images[0]!, mimeType: "image/jpeg" as const },
      { ...images[0]!, fileName: "../private.png" },
    ])
      expect(yield* f.store.save(f.sessionID, { ...input, images: [bad] }).pipe(Effect.flip)).toMatchObject({
        code: "invalid",
      })
    expect(
      yield* f.store
        .save(f.sessionID, { ...input, images: Array.from({ length: 5 }, () => images[0]!) })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect(yield* f.store.list(f.sessionID)).toEqual([])
  }),
)

it.live("feedback rejects oversized PNG and GIF header dimensions before decoding", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const png = Buffer.from(images[0]!.data, "base64")
    png.writeUInt32BE(65535, 16)
    png.writeUInt32BE(65535, 20)
    const gif = Buffer.from(images[2]!.data, "base64")
    gif.writeUInt16LE(65535, 6)
    gif.writeUInt16LE(65535, 8)
    for (const image of [
      { ...images[0]!, data: png.toString("base64") },
      { ...images[2]!, data: gif.toString("base64") },
    ]) {
      expect(yield* f.store.save(f.sessionID, { ...input, images: [image] }).pipe(Effect.flip)).toMatchObject({
        code: "invalid",
        message: "Feedback image exceeds 32 megapixels",
      })
    }
    expect(yield* f.store.list(f.sessionID)).toEqual([])
    expect(yield* f.database.db.select().from(FeedbackImageTable).all()).toEqual([])
  }),
)

it.live("feedback exact byte bounds, Session quota and cascades preserve bounded owned snapshots", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const four = yield* f.store.save(f.sessionID, { ...input, images: Array.from({ length: 4 }, () => images[0]!) })
    expect(four.images).toHaveLength(4)
    yield* f.store.remove(f.sessionID, four.id, 1)
    const bytes = Buffer.alloc(Feedback.MaxImageBytes)
    Buffer.from(images[0]!.data, "base64").copy(bytes)
    const full = { ...images[0]!, data: bytes.toString("base64") }
    const saved = yield* Effect.forEach(Array.from({ length: 4 }), () =>
      f.store.save(f.sessionID, { ...input, images: [full, full] }),
    )
    expect(saved[0]!.images!.map((image) => image.size)).toEqual([Feedback.MaxImageBytes, Feedback.MaxImageBytes])
    expect(yield* f.store.save(f.sessionID, { ...input, images: [images[0]!] }).pipe(Effect.flip)).toMatchObject({
      code: "capacity",
    })
    expect(
      yield* f.store
        .save(f.sessionID, {
          ...input,
          images: [{ ...full, data: Buffer.concat([bytes, Buffer.from([0])]).toString("base64") }],
        })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    expect(
      yield* f.store.save(f.sessionID, { ...input, images: [full, full, images[0]!] }).pipe(Effect.flip),
    ).toMatchObject({ code: "invalid" })
    const own = saved[0]!
    expect(yield* f.store.remove(f.sessionID, own.id, 1)).toBe(true)
    expect(
      yield* f.database.db.select().from(FeedbackImageTable).where(eq(FeedbackImageTable.draft_id, own.id)).all(),
    ).toEqual([])
    yield* f.database.db.delete(SessionTable).where(eq(SessionTable.id, f.sessionID)).run()
    for (const draft of saved)
      expect(
        yield* f.database.db.select().from(FeedbackImageTable).where(eq(FeedbackImageTable.draft_id, draft.id)).all(),
      ).toEqual([])
  }),
)

const fixture = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const sessionID = SessionID.create()
  const projectID = ProjectV2.ID.make("feedback-test-project")
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
      slug: "feedback",
      directory: "/tmp",
      title: "Feedback",
      version: "1",
    })
    .run()
  return { database, sessionID, store: SessionFeedback.make(database.db) }
})
