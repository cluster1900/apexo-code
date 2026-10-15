// Production native wait acceptance: never starts provider work itself.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const entered = Promise.withResolvers(), release = Promise.withResolvers()
const calls = []
const fixture = await startShellFixture(kind, { config: { snapshot: false }, next: async ({ body }) => { calls.push(body); entered.resolve(); await release.promise; return { content: "WAIT_FINISHED" } } })
const checks = []
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const session = (await fixture.api("/api/session", { location: { directory: fixture.directory }, model: { providerID: "xai", id: "grok-4.7" }, agent: "build" })).data
  const route = `/api/session/${session.id}`
  await fixture.api(`${route}/wait`, undefined, "POST")
  assert.equal(calls.length, 0)
  checks.push("idle-wait-does-not-start-provider-work")
  const input = { id: "msg_waitcheckpoint", prompt: { text: "Wait for completion" } }
  await fixture.api(`${route}/prompt`, { ...input, resume: false })
  await fixture.api(`${route}/wait`, undefined, "POST")
  assert.equal(calls.length, 0)
  assert.equal((await fixture.api(`${route}/message`)).data.length, 0)
  checks.push("wait-does-not-promote-admit-only-input")
  const run = fixture.api(`${route}/prompt`, { ...input, resume: true })
  await run
  await deadline(entered.promise, 15000, "provider entered")
  const state = { finished: false }
  const wait = fixture.api(`${route}/wait`, undefined, "POST").then(() => { state.finished = true })
  // A separate round trip observes the active ownership while provider output remains held.
  assert.ok((await fixture.api("/api/session/active")).data[session.id])
  assert.equal(state.finished, false)
  release.resolve()
  await Promise.all([run, wait])
  const messages = (await fixture.api(`${route}/message`)).data
  assert.ok(messages.some((message) => message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text === "WAIT_FINISHED")))
  assert.equal(calls.length, 1)
  await fixture.api(`${route}/wait`, undefined, "POST")
  assert.equal(calls.length, 1)
  checks.push("active-wait-joins-completion-without-follow-up-provider-call")
  const missing = await fetch(`${fixture.url}/api/session/ses_missingwait/wait?directory=${encodeURIComponent(fixture.directory)}`, { method: "POST" })
  assert.equal(missing.status, 404)
  await missing.text()
  checks.push("missing-session-wait-is-not-found")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, providerCalls: calls.length }, null, 2))
} finally { release.resolve(); await fixture.close() }
