// Exercise the production native API through CLI or packaged Desktop backends.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const entered = Promise.withResolvers()
const release = Promise.withResolvers()
const calls = []
const fixture = await startShellFixture(kind, {
  config: { snapshot: false, compaction: { auto: false } },
  next: async ({ body }) => {
    calls.push(body)
    if (calls.length === 1) return { content: "Remember the apricot decision." }
    if (calls.length === 2) return { content: "## Objective\nKeep the apricot decision." }
    if (calls.length === 3) return { error: { status: 400, message: "Summary unavailable" } }
    entered.resolve()
    await release.promise
    return { content: "CANCELLED_SUMMARY" }
  },
})
const checks = []
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const session = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
  const route = `/api/session/${session.id}`
  const raw = (path) =>
    fetch(`${fixture.url}${path}?directory=${encodeURIComponent(fixture.directory)}`, { method: "POST" })
  await fixture.api(`${route}/compact`, undefined, "POST")
  assert.equal(calls.length, 0)
  const input = { id: "msg_compactcheckpoint", prompt: { text: "Remember the apricot decision." } }
  await fixture.api(`${route}/prompt`, { ...input, resume: false })
  await fixture.api(`${route}/compact`, undefined, "POST")
  assert.equal(calls.length, 0)
  assert.equal((await fixture.api(`${route}/message`)).data.length, 0)
  checks.push("empty-compaction-does-not-promote-admitted-input")
  await fixture.api(`${route}/prompt`, { ...input, resume: true })
  await fixture.api(`${route}/wait`, undefined, "POST")
  assert.equal(calls.length, 1)
  await fixture.api(`${route}/prompt`, {
    id: "msg_compactpending",
    prompt: { text: "PENDING_SECRET" },
    delivery: "queue",
    resume: false,
  })
  await fixture.api(`${route}/compact`, undefined, "POST")
  const compacted = (await fixture.api(`${route}/message`)).data
  assert.equal(calls.length, 2)
  assert.equal(compacted.filter((message) => message.type === "user").length, 1)
  assert.equal(compacted.filter((message) => message.type === "assistant").length, 1)
  assert.ok(
    compacted.some(
      (message) => message.type === "compaction" && message.reason === "manual" && message.summary.includes("apricot"),
    ),
  )
  assert.equal(calls[1].tools?.length ?? 0, 0)
  assert.ok(!JSON.stringify(calls[1]).includes("PENDING_SECRET"))
  checks.push("manual-compaction-is-one-summary-stream-without-queue-promotion")
  const failed = await raw(`${route}/compact`)
  assert.equal(failed.status, 503)
  await failed.text()
  assert.deepEqual((await fixture.api(`${route}/message`)).data, compacted)
  assert.equal(calls.length, 3)
  checks.push("failed-summary-preserves-projected-history")
  const cancelled = raw(`${route}/compact`)
  await deadline(entered.promise, 15000, "compaction provider entered")
  await fixture.api(`${route}/interrupt`, undefined, "POST")
  release.resolve()
  const cancelledResponse = await cancelled
  await cancelledResponse.text()
  await fixture.api(`${route}/wait`, undefined, "POST")
  assert.deepEqual((await fixture.api(`${route}/message`)).data, compacted)
  assert.equal(calls.length, 4)
  checks.push("interrupt-settles-compaction-without-committing-summary")
  const missing = await raw("/api/session/ses_missingcompact/compact")
  assert.equal(missing.status, 404)
  await missing.text()
  checks.push("missing-session-compaction-is-not-found")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: calls.length }, null, 2))
} finally {
  release.resolve()
  await fixture.close()
}
