import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { afterEach, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Feedback } from "@apexo/schema/feedback"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(AppNodeBuilderV1.build(Session.node), httpApiLayer))
afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

it.instance("feedback HTTP stores drafts without model work and requires the reviewed revision", () =>
  Effect.gen(function* () {
    const ctx = yield* TestInstance
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Feedback HTTP" })
    const request = (suffix = "", method = "GET", body?: unknown) =>
      requestInDirectory(`/session/${session.id}/feedback${suffix}`, ctx.directory, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      })
    const initial = yield* request()
    expect(yield* initial.json).toEqual([])
    const saved = yield* request("", "POST", { title: "A bug", details: "Repro steps", type: "bug" })
    expect(saved.status).toBe(200)
    const draft = yield* saved.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Feedback.Draft)))
    const review = yield* request(`/${draft.id}/review`, "POST", { revision: 1 })
    expect(review.status).toBe(200)
    expect(yield* review.json).toMatchObject({ draft, title: "A bug" })
    expect((yield* request("", "POST", { ...draft, title: "Edited", draft_id: draft.id, revision: 1 })).status).toBe(
      200,
    )
    expect((yield* request(`/${draft.id}/review`, "POST", { revision: 1 })).status).toBe(409)
    expect((yield* request(`/${draft.id}`, "DELETE", { revision: 1 })).status).toBe(409)
    expect((yield* request(`/${draft.id}`, "DELETE", { revision: 2 })).status).toBe(200)
    expect((yield* request(`/${draft.id}/review`, "POST", { revision: 2 })).status).toBe(404)
    expect((yield* request("", "POST", { title: " ", details: "x", type: "idea" })).status).toBe(400)
    expect(yield* (yield* request()).json).toEqual([])
  }),
)

it.instance("feedback rejects foreign draft IDs and routes an owned session independently of directory hints", () =>
  Effect.gen(function* () {
    const trace = (stage: string) => {
      if (process.env.APEXO_TEST_FEEDBACK_TIMING === "1") console.error("FEEDBACK_HTTP_TIMING", stage, Date.now())
    }
    trace("body started")
    const ctx = yield* TestInstance
    const sessions = yield* Session.Service
    const owner = yield* sessions.create({ title: "Owner" })
    const other = yield* sessions.create({ title: "Other" })
    const saved = yield* requestInDirectory(`/session/${owner.id}/feedback`, ctx.directory, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private", details: "Local details", type: "bug" }),
    })
    const draft = yield* saved.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Feedback.Draft)))
    expect(
      (yield* requestInDirectory(`/session/${other.id}/feedback/${draft.id}/review`, ctx.directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: 1 }),
      })).status,
    ).toBe(404)
    trace("cross-session checked")
    const directory = yield* tmpdirScoped()
    trace("second directory created")
    const routed = yield* requestInDirectory(`/session/${owner.id}/feedback`, directory)
    expect(routed.status).toBe(200)
    expect(yield* routed.json).toEqual([draft])
    trace("cross-directory checked")
    const own = yield* requestInDirectory(`/session/${owner.id}/feedback`, ctx.directory)
    expect(yield* own.json).toEqual([draft])
    trace("body finished")
  }),
)

it.instance("feedback HTTP attachment reads require the exact owned revision", () =>
  Effect.gen(function* () {
    const ctx = yield* TestInstance
    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "Images HTTP" })
    const root = `/session/${session.id}/feedback`
    const post = (url: string, body: unknown) =>
      requestInDirectory(url, ctx.directory, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
    const saved = yield* post(root, {
      title: "Image report",
      details: "",
      type: "bug",
      images: [{ data, mimeType: "image/png", fileName: "preview.png" }],
    })
    expect(saved.status).toBe(200)
    const draft = yield* saved.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Feedback.Draft)))
    expect(draft.images).toHaveLength(1)
    expect(JSON.stringify(draft)).not.toContain(data)
    const image = draft.images![0]!
    const downloaded = yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 1 })
    expect(downloaded.status).toBe(200)
    expect(yield* downloaded.json).toEqual({ ...image, data })
    expect((yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 2 })).status).toBe(409)
    const other = yield* sessions.create({ title: "Other" })
    expect((yield* post(`/session/${other.id}/feedback/${draft.id}/image/${image.id}`, { revision: 1 })).status).toBe(
      404,
    )
    expect(
      (yield* post(root, {
        title: "Bad",
        details: "x",
        type: "bug",
        images: [{ data: "AAAA", mimeType: "image/png" }],
      })).status,
    ).toBe(400)
    expect(
      (yield* post(root, { title: "Updated", details: "x", type: "bug", draft_id: draft.id, revision: 1 })).status,
    ).toBe(200)
    expect((yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 1 })).status).toBe(409)
    expect((yield* post(`${root}/${draft.id}/image/${image.id}`, { revision: 2 })).status).toBe(200)
  }),
)
