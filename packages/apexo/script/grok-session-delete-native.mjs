// Native Session deletion through real CLI or packaged Desktop backends.
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
    if (JSON.stringify(body).includes("DELETE_ACTIVE_HOLD")) {
      entered.resolve()
      await release.promise
      return { content: "DELETED_LATE_RESPONSE" }
    }
    return { content: "INDEPENDENT_RESPONSE" }
  },
})
const checks = []
const create = async (id) =>
  (
    await fixture.api("/api/session", {
      ...(id ? { id } : {}),
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
const remove = async (id) => {
  // A misleading caller directory must not select the execution or storage owner.
  const response = await fetch(`${fixture.url}/api/session/${id}?directory=${encodeURIComponent("/not-the-owner")}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(response.status, 204, await response.text())
}
const missing = async (id) => {
  const response = await fetch(`${fixture.url}/api/session/${id}`, { signal: AbortSignal.timeout(15_000) })
  assert.equal(response.status, 404, await response.text())
}
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const idle = await create()
  await fixture.api(`/api/session/${idle.id}/prompt`, {
    id: "msg_deleteadmitonly",
    prompt: { text: "NEVER_PROMOTE_DELETED_INPUT" },
    resume: false,
  })
  await remove(idle.id)
  await missing(idle.id)
  assert.equal(calls.length, 0)
  checks.push("idle-deletion-removes-admitted-input-without-provider-work")
  await remove(idle.id)
  await remove("ses_missingnativedelete")
  assert.equal(calls.length, 0)
  checks.push("repeated-and-missing-deletion-are-idempotent")

  const reused = await create(idle.id)
  assert.equal(reused.id, idle.id)
  assert.deepEqual((await fixture.api(`/api/session/${reused.id}/message`)).data, [])
  await fixture.api(`/api/session/${reused.id}/wait`, undefined, "POST")
  assert.equal(calls.length, 0)
  checks.push("reused-id-has-no-old-transcript-or-admitted-work")

  const active = await create()
  await fixture.api(`/api/session/${active.id}/prompt`, {
    id: "msg_deleteactivehold",
    prompt: { text: "DELETE_ACTIVE_HOLD" },
  })
  await deadline(entered.promise, 15_000, "active provider entered")
  await fixture.api(`/api/session/${active.id}/prompt`, {
    id: "msg_deletesteerpending",
    prompt: { text: "NEVER_PROMOTE_AFTER_DELETE" },
    delivery: "steer",
  })
  const independent = await create()
  await fixture.api(`/api/session/${independent.id}/prompt`, {
    id: "msg_deleteindependent",
    prompt: { text: "Independent Session survives" },
  })
  await fixture.api(`/api/session/${independent.id}/wait`, undefined, "POST")
  await remove(active.id)
  await missing(active.id)
  assert.equal((await fixture.api("/api/session/active")).data[active.id], undefined)
  assert.equal(calls.length, 2)
  checks.push("active-deletion-joins-owned-execution-and-revokes-pending-steer")
  const independentMessages = (await fixture.api(`/api/session/${independent.id}/message`)).data
  assert.ok(JSON.stringify(independentMessages).includes("INDEPENDENT_RESPONSE"))
  checks.push("deletion-preserves-unrelated-session")

  await create(active.id)
  release.resolve()
  await fixture.api(`/api/session/${active.id}/prompt`, {
    id: "msg_deletereplacement",
    prompt: { text: "Only the replacement Session runs" },
  })
  await fixture.api(`/api/session/${active.id}/wait`, undefined, "POST")
  const replacement = (await fixture.api(`/api/session/${active.id}/message`)).data
  assert.ok(JSON.stringify(replacement).includes("Only the replacement Session runs"))
  assert.ok(!JSON.stringify(replacement).includes("DELETED_LATE_RESPONSE"))
  assert.ok(!JSON.stringify(replacement).includes("NEVER_PROMOTE_AFTER_DELETE"))
  assert.equal(calls.length, 3)
  checks.push("late-old-provider-result-cannot-write-to-reused-id")

  await remove(reused.id)
  await remove(active.id)
  await fixture.crash()
  await fixture.reopen()
  await missing(reused.id)
  await missing(active.id)
  assert.deepEqual((await fixture.api(`/api/session/${independent.id}/message`)).data, independentMessages)
  assert.equal(calls.length, 3)
  checks.push("deletion-persists-after-restart-without-affecting-other-history")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: calls.length }, null, 2))
} finally {
  release.resolve()
  await fixture.close()
}
