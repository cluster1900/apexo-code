import assert from "node:assert/strict"
import { startMcpFormsFixture } from "./mcp-forms-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"
const fixture = await startMcpFormsFixture()
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
  console.log(JSON.stringify({ checks, output: runtime.output }))
} finally {
  await fixture.close()
}
