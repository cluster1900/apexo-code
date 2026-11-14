import assert from "node:assert/strict"
import { Effect, Fiber, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { startPermissionReviewFixture } from "./permission-review-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"
import { createApexoClient } from "@apexo/sdk/v2/client"

const fixture = await startPermissionReviewFixture({ mixed: process.argv.includes("--mixed") })
const checks = []
const abort = new AbortController()
const seen = []
let listening
try {
  const { Apexo } = await import("../../client/src/index.ts")
  const client = Apexo.make({ baseUrl: fixture.runtime.url })
  const input = { sessionID: fixture.session.id }
  assert.deepEqual(await client.permissions.getReview(input), { mode: "manual", revision: 0 })
  checks.push("promise-mode-get")
  listening = (async () => {
    for await (const event of client.events.subscribe({ signal: abort.signal })) seen.push(event)
  })().catch((error) => {
    if (!abort.signal.aborted) throw error
  })
  await poll(() => seen.some((event) => event.type === "server.connected"), "client event stream ready")
  assert.deepEqual(await client.permissions.setReview({ ...input, mode: "review" }), { mode: "review", revision: 1 })
  await poll(() => seen.some((event) => event.type === "permission.review.mode.changed"), "client mode event")
  checks.push("promise-mode-set-and-canonical-event")
  const sdk = createApexoClient({ baseUrl: fixture.runtime.url })
  assert.equal((await sdk.v2.session.permissionReview.get(input, { throwOnError: true })).data.data.mode, "review")
  checks.push("legacy-sdk-mode-get")
  fixture.state.hold = true
  await fixture.prompt(input.sessionID)
  const request = await fixture.pending(input.sessionID, "reviewing")
  assert.equal((await client.permissions.list(input)).find((item) => item.id === request.id).review.status, "reviewing")
  assert.equal((await client.permissions.get({ ...input, requestID: request.id })).review.status, "reviewing")
  await poll(() => seen.some((event) => event.type === "permission.review.started"), "client review started event")
  checks.push("promise-pending-inline-review-and-start-event")
  fixture.state.hold = false
  await fixture.pending(input.sessionID, "ask_manual")
  await poll(() => seen.some((event) => event.type === "permission.review.settled"), "client review settled event")
  assert.equal(
    (await client.permissions.get({ ...input, requestID: request.id })).review.reason,
    "Fixture requires a human decision",
  )
  checks.push("promise-live-fallback-and-settled-event")
  await client.permissions.reply({ ...input, requestID: request.id, reply: "once" })
  assert.equal((await client.permissions.list(input)).length, 0)
  checks.push("promise-manual-reply")
  {
    const { Apexo } = await import("../../client/src/effect.ts")
    await Effect.runPromise(
      Effect.gen(function* () {
        const current = yield* Apexo.make({ baseUrl: fixture.runtime.url })
        assert.equal((yield* current.permissions.getReview(input)).mode, "review")
        const received = []
        const listening = yield* current.events.subscribe().pipe(
          Stream.runForEach((event) => Effect.sync(() => received.push(event))),
          Effect.forkChild,
        )
        yield* Effect.promise(() =>
          poll(() => received.some((event) => event.type === "server.connected"), "effect event stream ready"),
        )
        assert.equal((yield* current.permissions.setReview({ ...input, mode: "manual" })).mode, "manual")
        checks.push("effect-mode-get-set")
        yield* Effect.promise(() =>
          poll(() => received.some((event) => event.type === "permission.review.mode.changed"), "effect mode event"),
        )
        checks.push("effect-mode-event-subscription")
        yield* current.permissions.setReview({ ...input, mode: "review" })
        yield* Effect.promise(() => fixture.prompt(input.sessionID))
        const request = yield* Effect.promise(() => fixture.pending(input.sessionID, "ask_manual"))
        assert.equal((yield* current.permissions.get({ ...input, requestID: request.id })).review.status, "ask_manual")
        assert.equal(
          (yield* current.permissions.list(input)).find((item) => item.id === request.id).review.reason,
          "Fixture requires a human decision",
        )
        checks.push("effect-pending-inline-state-and-reason")
        yield* Effect.promise(() =>
          poll(
            () =>
              received.some((event) => event.type === "permission.review.started") &&
              received.some((event) => event.type === "permission.review.settled"),
            "effect review events",
          ),
        )
        checks.push("effect-canonical-start-and-settle-events")
        yield* current.permissions.reply({ ...input, requestID: request.id, reply: "once" })
        assert.equal((yield* current.permissions.list(input)).length, 0)
        checks.push("effect-manual-reply")
        yield* Fiber.interrupt(listening)
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped),
    )
  }
  assert.equal(
    (await sdk.v2.session.permissionReview.set({ ...input, mode: "review" }, { throwOnError: true })).data.data.mode,
    "review",
  )
  assert.equal((await client.permissions.getReview(input)).mode, "review")
  checks.push("legacy-sdk-mode-set-shares-backend-state")
  console.log(
    JSON.stringify({
      checks,
      eventTypes: [...new Set(seen.map((event) => event.type))].filter((type) => type.startsWith("permission.review")),
    }),
  )
} finally {
  fixture.state.hold = false
  abort.abort()
  await listening
  await fixture.close()
}
