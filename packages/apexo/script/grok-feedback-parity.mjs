// Real isolated CLI/Electron backend and model tool calls; no feedback leaves the fixture.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { poll, startShellFixture } from "./grok-shell-fixture.mjs"
const native = process.argv.includes("--native")
const planned = { args: {} }
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  next({ ancillary, finished }) {
    if (ancillary || finished) return { content: "Feedback saved locally." }
    return { tool: "send_feedback", args: planned.args }
  },
})
const results = []
try {
  if (native) await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const create = async (title) =>
    native
      ? (
          await runtime.api("/api/session", {
            location: { directory: runtime.directory },
            model: { providerID: "xai", id: "grok-4.7" },
            agent: "build",
            title,
          })
        ).data
      : runtime.api("/session", { title })
  const session = await create("Feedback fixture")
  const route = `${native ? "/api" : ""}/session/${session.id}`
  const root = `${route}/feedback`
  const prompt = async (args, marker) => {
    planned.args = args
    if (native) {
      const before = new Set((await runtime.api(`${route}/message`)).data.map((message) => message.id))
      await runtime.api(`${route}/prompt`, {
        id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        prompt: { text: marker },
      })
      await runtime.api(`${route}/wait`, undefined, "POST")
      return poll(
        async () =>
          (await runtime.api(`${route}/message`)).data
            .filter((message) => !before.has(message.id))
            .flatMap((message) => (message.type === "assistant" ? message.content : []))
            .find((part) => part.type === "tool" && ["completed", "error"].includes(part.state.status)),
        marker,
      )
    }
    const before = (await runtime.api(`/session/${session.id}/message`)).length
    await runtime.api(`/session/${session.id}/prompt_async`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: marker }],
    })
    return poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`))
          .slice(before)
          .flatMap((message) => message.parts)
          .find(
            (part) =>
              part.type === "tool" &&
              part.tool === "send_feedback" &&
              ["completed", "error"].includes(part.state.status),
          ),
      marker,
    )
  }
  const first = await prompt(
    {
      title: "Unexpected response",
      details: "What happened:\nUnexpected response\n\nRepro:\nUse the fixture",
      type: "bug",
      task_category: "debug",
    },
    "Create local feedback",
  )
  assert.equal(first.state.status, "completed", JSON.stringify(first))
  const draft = (await runtime.api(root))[0]
  assert.equal(draft.revision, 1)
  results.push("model saves local draft")
  const updated = await prompt(
    { title: `Updated ${draft.id}`, details: `Repro\n${draft.id}\n\nEvidence`, type: "bug", draft_id: draft.id },
    "Update that feedback draft",
  )
  assert.equal(updated.state.status, "completed", JSON.stringify(updated))
  const drafts = await runtime.api(root)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].revision, 2)
  assert.equal(drafts[0].details, "Repro\n\nEvidence")
  results.push("update preserves identity and removes leaked draft ID")
  const missing = await prompt(
    { title: "Missing", details: "Must not append", type: "idea", draft_id: "feedback_missing" },
    "Update nonexistent draft",
  )
  assert.equal(missing.state.status, "error")
  assert.equal((await runtime.api(root)).length, 1)
  results.push("missing update does not append")
  const reviewed = await runtime.api(`${root}/${draft.id}/review`, { revision: 2 })
  assert.ok(reviewed.url.startsWith("https://github.com/cluster1900/apexo-grok/issues/new?"))
  assert.equal((await runtime.api(root)).length, 1)
  results.push("review prepares issue without sending or deleting")
  const other = await create("Other owner")
  const wrong = await fetch(
    `${runtime.url}${native ? "/api" : ""}/session/${other.id}/feedback/${draft.id}/review?directory=${encodeURIComponent(runtime.directory)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 2 }),
    },
  )
  assert.equal(wrong.status, 404)
  results.push("cross-session review denied")
  const stale = await fetch(`${runtime.url}${root}/${draft.id}?directory=${encodeURIComponent(runtime.directory)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1 }),
  })
  assert.equal(stale.status, 409)
  results.push("stale deletion denied")
  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await runtime.api(root), drafts)
  results.push("real process death and reopening retain drafts")
  assert.equal(await runtime.api(`${root}/${draft.id}`, { revision: 2 }, "DELETE"), true)
  assert.deepEqual(await runtime.api(root), [])
  results.push("reviewed local deletion")
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      protocol: native ? "v2" : "v1",
      scenarios: results,
      providerCalls: runtime.calls.length,
    }),
  )
} finally {
  await runtime.close()
}
