export * as SessionFeedback from "./feedback"

import { randomUUID } from "node:crypto"
import { and, asc, eq, ne, notInArray, sql } from "drizzle-orm"
import { Clock, Effect, Schema } from "effect"
import { Feedback } from "@apexo/schema/feedback"
import { SessionID } from "@apexo/schema/session-id"
import { Database } from "../database/database"
import { FeedbackDraftTable, FeedbackImageTable } from "../feedback/sql"
import { SessionTable } from "./sql"

export class Error extends Schema.TaggedErrorClass<Error>()("FeedbackError", {
  code: Schema.Literals(["missing", "invalid", "conflict", "capacity", "storage"]),
  message: Schema.String,
}) {}

/** Local drafts only. Preparing a reviewed issue never submits it or deletes its draft. */
export function make(db: Database.Interface["db"]) {
  const boundary = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof Error
          ? error
          : new Error({ code: "storage", message: "Feedback draft storage is unavailable" }),
      ),
    )
  const requireSession = Effect.fnUntraced(function* (sessionID: SessionID) {
    if (!(yield* db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get()))
      return yield* new Error({ code: "missing", message: "Session not found" })
  })
  const read = Effect.fnUntraced(function* (sessionID: SessionID) {
    yield* requireSession(sessionID)
    const rows = yield* db
      .select()
      .from(FeedbackDraftTable)
      .where(eq(FeedbackDraftTable.session_id, sessionID))
      .orderBy(asc(FeedbackDraftTable.time_created), asc(FeedbackDraftTable.id))
      .all()
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(Feedback.Draft)(row.data).pipe(
        Effect.flatMap((draft) =>
          draft.id === row.id && draft.sessionID === sessionID
            ? Effect.succeed(draft)
            : Effect.fail(new Error({ code: "storage", message: "Feedback draft ownership is invalid" })),
        ),
      ),
    )
  })
  const list = (sessionID: SessionID) => boundary(read(sessionID))
  const save = (sessionID: SessionID, input: Feedback.Save) =>
    boundary(
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(Feedback.Save)(input).pipe(
          Effect.mapError(() => new Error({ code: "invalid", message: "Invalid feedback draft fields" })),
        )
        // Decode snapshots before taking the write lock. The transaction rechecks revision and ownership.
        const snapshots =
          decoded.images === undefined
            ? undefined
            : yield* Effect.forEach(decoded.images, (image) =>
                Effect.gen(function* () {
                  if ("id" in image) return image
                  return yield* snapshot(image)
                }),
              )
        return yield* db.transaction(
          () =>
            Effect.gen(function* () {
              const id = decoded.draft_id?.trim() || undefined
              const content = {
                title: stripID(decoded.title, id),
                details: stripID(decoded.details, id),
                product_area: decoded.product_area === undefined ? undefined : stripID(decoded.product_area, id),
                type: decoded.type,
                task_category: decoded.task_category,
                failure_mode: decoded.failure_mode,
              }
              if (!content.title.trim())
                return yield* new Error({ code: "invalid", message: "Feedback title must not be blank" })
              if (
                [content.title, content.details, content.product_area ?? ""].some(
                  (value) => Buffer.byteLength(value, "utf8") > 65_536,
                )
              )
                return yield* new Error({
                  code: "invalid",
                  message: "Feedback text fields must each fit within 64 KiB",
                })
              const drafts = yield* read(sessionID)
              const current = id ? drafts.find((draft) => draft.id === id) : undefined
              if (id && !current)
                return yield* new Error({ code: "missing", message: "Feedback draft not found in this session" })
              if (decoded.revision !== undefined && (!current || current.revision !== decoded.revision))
                return yield* new Error({
                  code: "conflict",
                  message: "The feedback draft changed; review the latest version",
                })
              if (current && snapshots !== undefined && decoded.revision === undefined)
                return yield* new Error({
                  code: "conflict",
                  message: "Image changes require the reviewed draft revision",
                })
              const images =
                snapshots === undefined
                  ? (current?.images ?? [])
                  : yield* Effect.forEach(snapshots, (image) =>
                      Effect.gen(function* () {
                        if ("data" in image) return image.metadata
                        const existing = current?.images?.find((entry) => entry.id === image.id)
                        if (!existing)
                          return yield* new Error({
                            code: "invalid",
                            message: "Image does not belong to this draft revision",
                          })
                        return existing
                      }),
                    )
              if (new Set(images.map((image) => image.id)).size !== images.length)
                return yield* new Error({ code: "invalid", message: "A feedback image may only appear once" })
              if (!content.details.trim() && images.length === 0)
                return yield* new Error({ code: "invalid", message: "Feedback details or an image are required" })
              const bytes = images.reduce((total, image) => total + image.size, 0)
              if (bytes > Feedback.MaxImageTotalBytes)
                return yield* new Error({ code: "invalid", message: "Feedback images exceed 16 MiB combined" })
              const stored = yield* db
                .select({ bytes: sql<number>`coalesce(sum(${FeedbackImageTable.size}), 0)` })
                .from(FeedbackImageTable)
                .innerJoin(FeedbackDraftTable, eq(FeedbackImageTable.draft_id, FeedbackDraftTable.id))
                .where(
                  and(
                    eq(FeedbackDraftTable.session_id, sessionID),
                    current ? ne(FeedbackDraftTable.id, current.id) : undefined,
                  ),
                )
                .get()
              if (Number(stored?.bytes ?? 0) + bytes > 64 * 1024 * 1024)
                return yield* new Error({ code: "capacity", message: "Feedback images for this session exceed 64 MiB" })
              if (!current && drafts.length >= 1000)
                return yield* new Error({ code: "capacity", message: "This session already has 1000 feedback drafts" })
              const now = yield* Clock.currentTimeMillis
              const draft: Feedback.Draft = {
                ...content,
                id: current?.id ?? `feedback_${randomUUID()}`,
                sessionID,
                revision: (current?.revision ?? 0) + 1,
                createdAt: current?.createdAt ?? now,
                updatedAt: now,
                images,
              }
              const next = current ? drafts.map((item) => (item.id === current.id ? draft : item)) : [...drafts, draft]
              if (Buffer.byteLength(JSON.stringify(next), "utf8") > 8 * 1024 * 1024)
                return yield* new Error({ code: "capacity", message: "Feedback drafts for this session exceed 8 MiB" })
              yield* db
                .insert(FeedbackDraftTable)
                .values({
                  id: draft.id,
                  session_id: sessionID,
                  data: draft,
                  time_created: draft.createdAt,
                })
                .onConflictDoUpdate({ target: FeedbackDraftTable.id, set: { data: draft } })
                .run()
              if (snapshots !== undefined) {
                yield* db
                  .delete(FeedbackImageTable)
                  .where(
                    and(
                      eq(FeedbackImageTable.draft_id, draft.id),
                      images.length
                        ? notInArray(
                            FeedbackImageTable.id,
                            images.map((image) => image.id),
                          )
                        : undefined,
                    ),
                  )
                  .run()
                yield* Effect.forEach(
                  snapshots.filter((image) => "data" in image),
                  (image) =>
                    db
                      .insert(FeedbackImageTable)
                      .values({
                        id: image.metadata.id,
                        draft_id: draft.id,
                        mime_type: image.metadata.mimeType,
                        file_name: image.metadata.fileName,
                        size: image.metadata.size,
                        data: image.data,
                      })
                      .run(),
                )
              }
              return draft
            }),
          { behavior: "immediate" },
        )
      }),
    )
  const saveText = (sessionID: SessionID, input: Feedback.ToolSave) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(Feedback.ToolSave)(input).pipe(
        Effect.mapError(() => new Error({ code: "invalid", message: "Invalid feedback draft fields" })),
      )
      if (!stripID(decoded.details, decoded.draft_id?.trim()).trim())
        return yield* new Error({ code: "invalid", message: "Feedback title and details must not be blank" })
      return yield* save(sessionID, decoded)
    })
  const remove = (sessionID: SessionID, id: string, revision: number) =>
    boundary(
      db.transaction(
        () =>
          Effect.gen(function* () {
            const draft = (yield* read(sessionID)).find((item) => item.id === id)
            if (!draft) return false
            if (draft.revision !== revision)
              return yield* new Error({
                code: "conflict",
                message: "The feedback draft changed; review the latest version",
              })
            yield* db
              .delete(FeedbackDraftTable)
              .where(and(eq(FeedbackDraftTable.session_id, sessionID), eq(FeedbackDraftTable.id, id)))
              .run()
            return true
          }),
        { behavior: "immediate" },
      ),
    )
  const review = (sessionID: SessionID, id: string, revision: number) =>
    boundary(
      Effect.gen(function* () {
        const draft = (yield* read(sessionID)).find((item) => item.id === id)
        if (!draft) return yield* new Error({ code: "missing", message: "Feedback draft not found in this session" })
        if (draft.revision !== revision)
          return yield* new Error({
            code: "conflict",
            message: "The feedback draft changed; review the latest version",
          })
        const body = [
          `Type: ${draft.type}`,
          draft.product_area ? `Product area: ${draft.product_area}` : undefined,
          draft.task_category ? `Task: ${draft.task_category}` : undefined,
          draft.failure_mode ? `Failure mode: ${draft.failure_mode}` : undefined,
          "",
          draft.details,
        ]
          .filter((line) => line !== undefined)
          .join("\n")
        // Large drafts remain copyable/downloadable; browsers do not reliably accept unbounded issue URLs.
        const url = new URL("https://github.com/cluster1900/apexo-grok/issues/new")
        url.searchParams.set("title", draft.title)
        url.searchParams.set("body", body)
        return {
          draft,
          title: draft.title,
          body,
          url: url.href.length <= 8000 ? url.href : "https://github.com/cluster1900/apexo-grok/issues/new",
        }
      }),
    )
  const image = (sessionID: SessionID, id: string, revision: number, imageID: string) =>
    boundary(
      db.transaction(() =>
        Effect.gen(function* () {
          const draft = (yield* read(sessionID)).find((item) => item.id === id)
          if (!draft) return yield* new Error({ code: "missing", message: "Feedback draft not found in this session" })
          if (draft.revision !== revision)
            return yield* new Error({
              code: "conflict",
              message: "The feedback draft changed; review the latest version",
            })
          const metadata = draft.images?.find((entry) => entry.id === imageID)
          if (!metadata) return yield* new Error({ code: "missing", message: "Feedback image not found in this draft" })
          const row = yield* db
            .select()
            .from(FeedbackImageTable)
            .where(and(eq(FeedbackImageTable.id, imageID), eq(FeedbackImageTable.draft_id, id)))
            .get()
          if (
            !row ||
            row.size !== metadata.size ||
            row.data.length !== metadata.size ||
            row.mime_type !== metadata.mimeType ||
            row.file_name !== metadata.fileName
          )
            return yield* new Error({ code: "storage", message: "Feedback image snapshot is unavailable" })
          return { ...metadata, data: Buffer.from(row.data).toString("base64") }
        }),
      ),
    )
  return { list, save, saveText, remove, review, image }
}

export type Interface = ReturnType<typeof make>

const snapshot = (input: Feedback.ImageSnapshot) =>
  Effect.gen(function* () {
    const bytes = Buffer.from(input.data, "base64")
    if (!bytes.length || bytes.length > Feedback.MaxImageBytes || bytes.toString("base64") !== input.data)
      return yield* new Error({ code: "invalid", message: "Feedback image must contain valid base64 within 8 MiB" })
    const header = imageHeader(bytes)
    if (!header || header.mime !== input.mimeType)
      return yield* new Error({
        code: "invalid",
        message: "Feedback image format does not match PNG, JPEG or GIF metadata",
      })
    // Reject oversized header dimensions before invoking the decoder.
    if (!header.width || !header.height || header.width * header.height > 32 * 1024 * 1024)
      return yield* new Error({ code: "invalid", message: "Feedback image exceeds 32 megapixels" })
    const name = input.fileName?.trim() || `image.${input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.slice(6)}`
    if (name === "." || name === ".." || /[\\/\x00-\x1f\x7f]/.test(name) || Buffer.byteLength(name, "utf8") > 255)
      return yield* new Error({ code: "invalid", message: "Feedback image filename must be a safe display name" })
    const adapter = yield* Effect.tryPromise({
      try: () => import("../image/photon"),
      catch: () => new Error({ code: "storage", message: "Feedback image validation is unavailable" }),
    })
    const normalize = yield* adapter.make
    yield* normalize(
      "feedback image",
      { uri: "feedback:image", name: undefined, content: input.data, mime: input.mimeType, encoding: "base64" },
      {
        autoResize: false,
        maxWidth: header.width,
        maxHeight: header.height,
        maxBase64Bytes: input.data.length,
      },
    ).pipe(Effect.mapError(() => new Error({ code: "invalid", message: "Feedback image could not be decoded" })))
    return {
      metadata: { id: `feedback_image_${randomUUID()}`, mimeType: input.mimeType, fileName: name, size: bytes.length },
      data: bytes,
    }
  })

function imageHeader(bytes: Buffer) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return { mime: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
    return { mime: "image/gif", width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes[0] !== 255 || bytes[1] !== 216) return
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) return
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 218 || marker === 217 || offset + 2 > bytes.length) return
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
      return length >= 8
        ? { mime: "image/jpeg", width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
        : undefined
    offset += length
  }
}

function stripID(text: string, id?: string) {
  if (!id) return text
  return text
    .split("\n")
    .flatMap((line) => {
      if (!line.includes(id)) return [line]
      const stripped = line.replaceAll(id, "")
      return stripped.trim() ? [stripped] : []
    })
    .join("\n")
}
