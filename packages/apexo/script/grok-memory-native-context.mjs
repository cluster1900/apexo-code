// Native Apexo Sessions execute every turn; compatibility management only seeds first-party storage.
import assert from "node:assert/strict"
import { basename, join } from "node:path"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const calls = [], checks = []
const fixture = await startShellFixture(kind, {
  config: {
    snapshot: false,
    memory_v2: { enabled: true, capture_enabled: false, automatic_dream_enabled: false },
    memory: { enabled: true },
    agent: { blocked: { permission: { read: "deny" } }, undecided: { permission: { read: "ask" } } },
    compaction: { auto: true, reserved: 50000, preserve_recent_tokens: 0, memory_flush: { enabled: false } },
  },
  next({ body, ancillary }) {
    calls.push(body)
    return { content: ancillary ? "The user is inspecting saved memory. Continue after compaction." : "NATIVE_MEMORY_CONTEXT_ACK" }
  },
})
const root = (id) => `/api/session/${id}`
const memory = (id) => `/experimental/session/${id}/memory`
const create = async (agent = "build") => (await fixture.api("/api/session", {
  location: { directory: fixture.directory }, model: { providerID: "xai", id: "grok-4.7" }, agent,
})).data
const rendered = (body) => JSON.stringify(body.messages ?? body.input)
const block = (body) => (body.messages ?? body.input).filter((item) => item.role === "system")
  .flatMap((item) => typeof item.content === "string" ? [item.content] : item.content.map((part) => part.text ?? ""))
  .join("\n").match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? ""
const prompt = async (session, text, expectedCalls = 1) => {
  const before = calls.length
  await fixture.api(`${root(session.id)}/prompt`, { prompt: { text }, resume: true })
  await poll(async () => calls.length > before && !Object.hasOwn((await fixture.api("/api/session/active")).data, session.id), "native memory turn settlement", 30000)
  assert.equal(calls.length, before + expectedCalls, "Expected provider turns, including explicit compaction fixture")
  return calls.at(-1)
}
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const seed = await fixture.api("/session", { title: "Isolated memory storage seed" })
  const first = await fixture.api(`${memory(seed.id)}/remember`, { content: "# NATIVE_FIRST_NOTE\nStable remembered preference.", scope: "workspace" })
  const session = await create()
  const initial = block(await prompt(session, "Inspect saved memory."))
  assert.match(initial, /NATIVE_FIRST_NOTE/)
  assert.ok(initial.includes(basename(first.path)))
  checks.push("native-first-provider-request-includes-memory-index")

  const later = await fixture.api(`${memory(seed.id)}/remember`, { content: "# NATIVE_LATER_NOTE\nLater preference.", scope: "workspace" })
  assert.equal(block(await prompt(session, "Continue with the existing context.")), initial)
  await fixture.crash()
  await fixture.reopen()
  assert.equal(block(await prompt(session, "Resume with the admitted context.")), initial)
  checks.push("ordinary-turn-and-process-reopen-preserve-selection")
  const fresh = await create()
  assert.match(block(await prompt(fresh, "Inspect all current notes.")), /NATIVE_LATER_NOTE/)
  checks.push("new-session-refreshes-selection")

  assert.match(block(await prompt(session, `Compact this long conversation and continue. ${"Evidence boundary. ".repeat(14000)}`, 2)), /NATIVE_LATER_NOTE/)
  assert.ok((await fixture.api(`${root(session.id)}/message`)).data.some((message) => message.type === "compaction" && message.reason === "auto" && message.summary.includes("Continue after compaction")))
  checks.push("real-native-compaction-refreshes-selection")

  for (const agent of ["blocked", "undecided"]) {
    const denied = await create(agent)
    assert.equal(block(await prompt(denied, "Inspect saved memory without an approval request.")), "")
    assert.deepEqual((await fixture.api(`${root(denied.id)}/permission`)).data, [])
  }
  checks.push("agent-deny-and-ask-do-not-inject-or-request-approval")

  await fixture.api(`${memory(session.id)}/toggle`, { enabled: false })
  const disabled = await prompt(session, "Continue with memory disabled.")
  assert.match(rendered(disabled), /Saved memory context is no longer available or permitted/)
  assert.ok((await fixture.api(`${root(session.id)}/message`)).data.some((message) => message.type === "system" && message.text.includes("Do not rely")))
  checks.push("disable-publishes-durable-context-withdrawal")

  const url = new URL(`${memory(seed.id)}/note`, fixture.url)
  url.searchParams.set("directory", fixture.directory)
  url.searchParams.set("path", first.path)
  const response = await fetch(url)
  assert.ok(response.ok)
  const preview = await response.json()
  await fixture.api(`${memory(seed.id)}/forget`, { path: first.path, hash: preview.hash })
  const forgotten = await prompt(fresh, "Continue after forgetting a note.")
  assert.match(rendered(forgotten), /Saved memory context changed/)
  const replacement = block(await prompt(fresh, `Compact and inspect current memory. ${"Evidence boundary. ".repeat(14000)}`, 2))
  assert.ok(!replacement.includes(basename(first.path)))
  assert.ok(replacement.includes(basename(later.path)))
  checks.push("forget-invalidates-cache-and-compaction-replaces-baseline")
  console.log(JSON.stringify({ result: "pass", kind, checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  await writeFile(join(fixture.output, "native-memory-context.json"), JSON.stringify({ checks, calls }, null, 2))
  await fixture.close()
}
