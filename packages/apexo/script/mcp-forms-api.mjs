import assert from "node:assert/strict"
import { Apexo } from "../../client/src/index.ts"
import { make } from "../../client/src/generated-effect/client.ts"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { watchMcpElicitations } from "@apexo/sdk/v2/mcp-elicitation"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { startMcpFormsFixture } from "./mcp-forms-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"
const fixture = await startMcpFormsFixture({ git: true })
const { runtime, session } = fixture
const checks = []
try {
  const other = await fixture.create()
  await fixture.prompt(session.id)
  const request = await fixture.pending(session.id)
  const path = `/api/session/${session.id}/mcp/elicitation/${request.id}/reply`
  await runtime.api(`/api/session/${other.id}/mcp/elicitation/${request.id}/reply`, { action: "decline" }, "POST", 404)
  await runtime.api(path, { action: "decline", content: {} }, "POST", 400)
  await runtime.api(path, { action: "accept", content: { unknown: true } }, "POST", 400)
  await runtime.api(path, { action: "decline", unexpected: true }, "POST", 400)
  assert.equal((await runtime.api(`/api/session/${session.id}/mcp/elicitation`)).length, 1)
  checks.push("cross-session-and-invalid-replies-preserve-pending")
  await runtime.api(path, { action: "decline" })
  await runtime.api(path, { action: "decline" })
  await runtime.api(path, { action: "cancel" }, "POST", 409)
  checks.push("duplicate-idempotency-and-conflict")
  await poll(
    async () => (await runtime.api(`/api/session/${session.id}/mcp/elicitation`)).length === 0,
    "empty after reply",
  )
  await fixture.prompt(session.id)
  const pending = await fixture.pending(session.id)
  await runtime.api(`/api/session/${session.id}`, undefined, "DELETE")
  await runtime.api(
    `/api/session/${session.id}/mcp/elicitation/${pending.id}/reply`,
    { action: "accept", content: {} },
    "POST",
    404,
  )
  checks.push("delete-clears-owner-and-stale-reply")
  await runtime.api("/api/mcp/forms/connect", undefined, "POST")
  const owner = await fixture.create()
  const client = Apexo.make({ baseUrl: runtime.url })["server.mcpElicitation"]
  for (const scenario of ["F04_NESTED", "F04_WORKTREE"]) {
    await fixture.prompt(owner.id, undefined, scenario)
    const form = await fixture.pending(owner.id)
    assert.notEqual(form.sessionID, owner.id)
    assert.deepEqual(await client.list({ sessionID: owner.id }), [])
    assert.deepEqual(await client.list({ sessionID: other.id, includeDescendants: "true" }), [])
    assert.deepEqual(
      (await client.list({ sessionID: owner.id, includeDescendants: "true" })).map((item) => item.id),
      [form.id],
    )
    const child = (await runtime.api(`/api/session/${form.sessionID}`)).data
    if (scenario === "F04_WORKTREE") assert.notEqual(child.location.directory, runtime.directory)
    const ids = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* make({ baseUrl: runtime.url })
        return (yield* client["server.mcpElicitation"].list({ sessionID: owner.id, includeDescendants: "true" })).map(
          (item) => item.id,
        )
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    )
    assert.deepEqual(ids, [form.id])
    await runtime.api(`/api/session/${owner.id}/mcp/elicitation/${form.id}/reply`, { action: "decline" }, "POST", 404)
    await client.reply({ sessionID: form.sessionID, requestID: form.id, action: "decline" })
    await poll(
      async () => (await client.list({ sessionID: owner.id, includeDescendants: "true" })).length === 0,
      "descendant settlement",
    )
    await runtime.api(`/api/session/${owner.id}/wait`, undefined, "POST")
    checks.push(`${scenario}-canonical-and-effect-client-discovery-and-owner-only-reply`)
  }
  await fixture.prompt(owner.id)
  const stale = await fixture.pending(owner.id)
  const live = { requests: [] }
  const watcher = watchMcpElicitations(
    createApexoClient({ baseUrl: runtime.url }).v2.mcpElicitation,
    () => [owner.id],
    (requests) => {
      live.requests = requests
    },
  )
  try {
    await poll(() => live.requests[0]?.id === stale.id, "client holds pending form")
    const before = fixture.calls.length
    await fixture.restartBackend()
    assert.deepEqual(await client.list({ sessionID: owner.id, includeDescendants: "true" }), [])
    await runtime.api(
      `/api/session/${owner.id}/mcp/elicitation/${stale.id}/reply`,
      { action: "accept", content: {} },
      "POST",
      404,
    )
    await watcher.refresh()
    assert.deepEqual(live.requests, [])
    assert.equal(fixture.calls.length, before)
    checks.push("backend-restart-clears-live-client-stale-reply-404-and-no-call-replay")
  } finally {
    watcher.close()
  }
  console.log(JSON.stringify({ checks, output: runtime.output }))
} finally {
  await fixture.close()
  console.error(`Form API evidence: ${runtime.output}; checks: ${checks.join(", ")}`)
}
