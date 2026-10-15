import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const rewrites = []
const hold = { value: undefined }
const runtime = await startShellFixture(kind, {
  next: async (input) => {
    if (!JSON.stringify(input.input).includes("You are a memory note formatter")) return
    rewrites.push(input.body)
    if (hold.value) await hold.value.promise
    return { content: "## Preferences\nUse REVIEW_REWRITTEN concise responses." }
  },
})
const checks = []
try {
  const session = await runtime.api("/session", { title: "Memory review verification" })
  const endpoint = `/experimental/session/${session.id}/memory`
  const messages = () => runtime.api(`/session/${session.id}/message`)
  const global = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory", "MEMORY.md")
  const saved = () =>
    readFile(global, "utf8").catch((error) => {
      if (error.code === "ENOENT") return ""
      throw error
    })
  assert.equal((await runtime.api(`${endpoint}/status`)).enabled, false)
  assert.equal(
    (await runtime.api(`${endpoint}/rewrite`, { content: "REVIEW_RAW concise responses" })).content,
    "## Preferences\nUse REVIEW_REWRITTEN concise responses.",
  )
  assert.equal(await saved(), "")
  assert.deepEqual(await messages(), [])
  assert.equal(rewrites.length, 1)
  assert.equal(rewrites[0].tools?.length ?? 0, 0)
  checks.push("rewrite-without-save", "rewrite-without-main-turn", "rewrite-without-tools")
  await runtime.api(`${endpoint}/remember`, { content: "REVIEW_ORIGINAL" })
  assert.match(await saved(), /REVIEW_ORIGINAL/)
  assert.doesNotMatch(await saved(), /REVIEW_REWRITTEN/)
  assert.deepEqual(await messages(), [])
  checks.push("confirm-original-default-global", "manual-save-while-memory-off")
  await runtime.api(`${endpoint}/remember`, { content: "## Edited\nREVIEW_EDITED", scope: "workspace" })
  const notes = await runtime.api(endpoint)
  const workspace = notes.find((note) => note.source === "workspace")
  assert.match(await readFile(workspace.path, "utf8"), /REVIEW_EDITED/)
  assert.doesNotMatch(await saved(), /REVIEW_EDITED/)
  checks.push("confirm-edited-workspace")
  const beforeCalls = runtime.calls.length
  await Promise.all(
    ["CONCURRENT_ONE", "CONCURRENT_TWO"].map((content) => runtime.api(`${endpoint}/remember`, { content })),
  )
  assert.match(await saved(), /CONCURRENT_ONE/)
  assert.match(await saved(), /CONCURRENT_TWO/)
  assert.equal(runtime.calls.length, beforeCalls)
  checks.push("concurrent-confirmations", "save-without-model")
  for (const content of ["   ", "界".repeat(11000)]) {
    const result = await fetch(
      `${runtime.url}${endpoint}/remember?directory=${encodeURIComponent(runtime.directory)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      },
    )
    assert.equal(result.status, 400)
    await result.text()
  }
  checks.push("empty-and-utf8-limit")
  const denied = await runtime.api("/session", {
    title: "Denied memory review",
    permission: [{ permission: "edit", pattern: "*", action: "deny" }],
  })
  await assert.rejects(() => runtime.api(`/experimental/session/${denied.id}/memory/remember`, { content: "DENIED" }))
  assert.doesNotMatch(await saved(), /DENIED/)
  checks.push("session-write-permission")
  hold.value = Promise.withResolvers()
  const abort = new AbortController()
  const cancelled = fetch(`${runtime.url}${endpoint}/rewrite?directory=${encodeURIComponent(runtime.directory)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "CANCEL_REWRITE" }),
    signal: abort.signal,
  }).catch(() => undefined)
  await poll(() => rewrites.length === 2, "rewrite started")
  abort.abort()
  hold.value.resolve()
  await cancelled
  hold.value = undefined
  assert.doesNotMatch(await saved(), /CANCEL_REWRITE|REVIEW_REWRITTEN/)
  assert.deepEqual(await messages(), [])
  checks.push("cancel-rewrite-preserves-storage-and-transcript")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, output: runtime.output }, null, 2))
} finally {
  hold.value?.resolve()
  await writeFile(join(runtime.output, "memory-review.json"), JSON.stringify({ checks, rewrites }, null, 2))
  await runtime.close()
  console.error(`Memory review evidence: ${runtime.output}`)
}
