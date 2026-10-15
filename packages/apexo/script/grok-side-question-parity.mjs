import assert from "node:assert/strict"
import { poll, startShellFixture } from "./grok-shell-fixture.mjs"

const captures = []
const gates = { main: Promise.withResolvers(), side: Promise.withResolvers() }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  async next({ body, text }) {
    captures.push(body)
    if (text.includes("MAIN_HOLD")) await gates.main.promise
    if (text.includes("SIDE_HOLD")) await gates.side.promise
    if (text.includes("SIDE_FAILURE")) return { error: { status: 400, message: "secret-token fixture rejection" } }
    return { content: text.includes("SIDE_") ? "SIDE_ANSWER" : "MAIN_ANSWER" }
  },
})
const passed = []
try {
  const session = await runtime.api("/session", { title: "Side question fixture" })
  const root = `/session/${session.id}/side-question`
  const prompt = (text) =>
    runtime.api(`/session/${session.id}/prompt_async`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text }],
    })
  await prompt("MAIN_CONTEXT unique fact: apricot")
  await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`)).some((message) =>
        message.parts.some((part) => part.type === "text" && part.text === "MAIN_ANSWER"),
      ),
    "main seed",
  )
  const before = await runtime.api(`/session/${session.id}/message`)
  const entry = await runtime.api(root, { question: "SIDE_CONTEXT what fruit?" })
  await poll(
    async () => (await runtime.api(root)).find((item) => item.id === entry.id && item.status === "completed"),
    "side answer",
  )
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
  const request = captures.find((body) =>
    JSON.stringify(body.messages?.at(-1) ?? body.input?.at(-1)).includes("SIDE_CONTEXT"),
  )
  assert.ok(JSON.stringify(request).includes("apricot"))
  assert.equal(request.tools?.length ?? 0, 0)
  passed.push("real model request inherits snapshot without transcript writes or executable tools")

  await prompt("MAIN_HOLD continue main work")
  await poll(
    () => captures.some((body) => JSON.stringify(body.messages?.at(-1) ?? body.input?.at(-1)).includes("MAIN_HOLD")),
    "main active",
  )
  const held = await runtime.api(root, { question: "SIDE_HOLD wait independently" })
  await poll(
    () => captures.some((body) => JSON.stringify(body.messages?.at(-1) ?? body.input?.at(-1)).includes("SIDE_HOLD")),
    "side active",
  )
  const sibling = await runtime.api(root, { question: "SIDE_FAST answer now" })
  await poll(
    async () => (await runtime.api(root)).find((item) => item.id === sibling.id && item.status === "completed"),
    "side sibling",
  )
  assert.equal((await runtime.api(`${root}/${held.id}/cancel`, undefined, "POST")).status, "cancelled")
  assert.equal((await runtime.api(root)).find((item) => item.id === sibling.id).status, "completed")
  assert.ok(
    !(await runtime.api(`/session/${session.id}/message`)).some((message) =>
      message.parts.some((part) => part.type === "text" && part.text.includes("SIDE_")),
    ),
  )
  passed.push("side cancellation and sibling completion while main provider remains active")
  gates.main.resolve()
  gates.side.resolve()
  await poll(
    async () =>
      (await runtime.api(`/session/${session.id}/message`)).filter((message) =>
        message.parts.some((part) => part.type === "text" && part.text === "MAIN_ANSWER"),
      ).length === 2,
    "main completes independently",
  )
  passed.push("main continues after side cancellation")

  const other = await runtime.api("/session", { title: "Other owner" })
  const forbidden = await fetch(
    `${runtime.url}/session/${other.id}/side-question/${entry.id}/cancel?directory=${encodeURIComponent(runtime.directory)}`,
    { method: "POST" },
  )
  assert.equal(forbidden.status, 404)
  passed.push("cross-session side cancellation denied")
  const failed = await runtime.api(root, { question: "SIDE_FAILURE" })
  await poll(
    async () => (await runtime.api(root)).find((item) => item.id === failed.id && item.status === "failed"),
    "sanitized failure",
  )
  assert.ok(!JSON.stringify(await runtime.api(root)).includes("secret-token"))
  passed.push("provider errors persisted without secret details")
  const saved = await runtime.api(root)
  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await runtime.api(root), saved)
  passed.push("real process crash and reopen preserve separate answers")
  console.log(
    JSON.stringify({ result: "pass", runtime: process.argv[2] ?? "cli", passed, output: runtime.output }, null, 2),
  )
} finally {
  gates.main.resolve()
  gates.side.resolve()
  await runtime.close()
}
