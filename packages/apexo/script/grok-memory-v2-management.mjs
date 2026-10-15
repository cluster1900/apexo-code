import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const large = process.argv.includes("--large")
const checks = [],
  contexts = [],
  commands = []
const extraction = { hold: undefined, started: 0, content: "" }
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: { enabled: true },
    memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input, ancillary }) {
    if (JSON.stringify(input).includes("You extract durable memory observations")) {
      extraction.started++
      const statement = extraction.content
      if (extraction.hold) await extraction.hold.promise
      return {
        content: JSON.stringify(
          statement
            ? { outcome: "observations", observations: [{ type: "project", statement }] }
            : { outcome: "noop", observations: [] },
        ),
      }
    }
    if (!ancillary) {
      const text = input
        .filter((item) => item.role === "system")
        .map((item) =>
          typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
        )
        .join("\n")
      contexts.push(text.match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? "")
    }
    return { content: "MEMORY_V2_MANAGEMENT_ACK" }
  },
})
const endpoint = (id) => `/experimental/session/${id}/memory`
const create = async (extra = {}) => (await runtime.api("/session", { title: "Memory V2 management", ...extra })).id
const save = (id, content, scope) => runtime.api(`${endpoint(id)}/remember`, { content, ...(scope ? { scope } : {}) })
const list = (id) => runtime.api(endpoint(id))
const query = async (path, search) => {
  const response = await fetch(
    `${runtime.url}${path}?${new URLSearchParams({ directory: runtime.directory, ...search })}`,
  )
  assert.ok(response.ok, await response.clone().text())
  return response.json()
}
const preview = (id, path) => query(`${endpoint(id)}/note`, { path })
const forget = async (id, path) => {
  const note = await preview(id, path)
  return runtime.api(`${endpoint(id)}/forget`, { path, hash: note.hash })
}
const flush = async (id) => {
  await runtime.api(`${endpoint(id)}/operation`, { kind: "flush" })
  return poll(
    async () => {
      const value = await runtime.api(`${endpoint(id)}/operation`)
      return value?.state === "finished" ? value.result : undefined
    },
    "capture barrier",
    30000,
  )
}
const prompt = async (id, text = "Use the saved project preferences.") => {
  const before = contexts.length
  await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })
  assert.ok(contexts.length > before)
  return contexts.at(-1)
}
const clear = async (...args) => {
  const result = await promisify(execFile)("bun", [resolve("src/index.ts"), "memory", "clear", "--yes", ...args], {
    cwd: runtime.directory,
    env: runtime.env,
    timeout: 45000,
  })
  commands.push({ args, ...result })
  assert.match(result.stdout, /Memory cleared/)
}
const status = async (id, suffix, body) => {
  const response = await fetch(
    `${runtime.url}${endpoint(id)}${suffix}?directory=${encodeURIComponent(runtime.directory)}`,
    {
      method: body ? "POST" : "GET",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    },
  )
  await response.text()
  return response.status
}
try {
  const legacy = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory", "MEMORY.md")
  await mkdir(dirname(legacy), { recursive: true })
  await writeFile(legacy, "LEGACY_KEEP")
  const id = await create()
  assert.equal((await runtime.api(`${endpoint(id)}/status`)).enabled, true)
  const first = await save(id, "# GLOBAL_MANUAL_FIRST\nPreference body")
  const second = await save(id, "# Preferences\nGLOBAL_MANUAL_SECOND")
  const workspace = await save(id, "# WORKSPACE_MANUAL\nProject body", "workspace")
  assert.notEqual(first.path, second.path)
  assert.match(first.path, /memory-v2\/apexo\/global\/observations\/_inbox\/remember-/)
  assert.deepEqual(
    (await list(id)).filter((note) => note.name !== "MEMORY.md").map((note) => note.source),
    ["global", "global", "workspace"],
  )
  assert.equal((await query(endpoint(id), { search: "GLOBAL_MANUAL_FIRST" })).length, 1)
  assert.equal((await list(id)).filter((note) => note.name === "MEMORY.md" && !note.deletable).length, 2)
  checks.push("distinct-manual-observations", "scope-groups", "search")
  const large = await save(id, "a".repeat(65536))
  assert.equal((await preview(id, large.path)).content.length, 65536)
  assert.equal(await status(id, "/remember", { content: "界".repeat(21846) }), 400)
  await forget(id, large.path)
  checks.push("manual-64k-byte-limit")
  const beforeEdit = await preview(id, second.path)
  await writeFile(second.path, "GLOBAL_MANUAL_EDITED")
  assert.equal(await status(id, "/forget", { path: second.path, hash: beforeEdit.hash }), 409)
  assert.equal(await readFile(second.path, "utf8"), "GLOBAL_MANUAL_EDITED")
  const manifest = join(dirname(dirname(dirname(first.path))), "MEMORY.md")
  const index = await preview(id, manifest)
  assert.equal(index.deletable, false)
  assert.equal(await status(id, "/forget", { path: manifest, hash: index.hash }), 403)
  checks.push("changed-preview-rejected", "generated-index-protected")
  const initial = await prompt(id)
  assert.match(initial, /GLOBAL_MANUAL_FIRST/)
  assert.match(initial, /WORKSPACE_MANUAL/)
  assert.doesNotMatch(initial, /LEGACY_KEEP/)
  await flush(id)
  await save(id, "# GLOBAL_ADDED_LATER")
  assert.equal(await prompt(id), initial)
  await flush(id)
  await runtime.api("/instance/dispose", undefined, "POST")
  assert.equal(await prompt(id), initial)
  await flush(id)
  checks.push("persisted-context-after-reopen")
  await runtime.api(`/session/${id}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  assert.match(await prompt(id), /GLOBAL_ADDED_LATER/)
  await flush(id)
  assert.ok(
    (await runtime.api(`/session/${id}/message`)).some((message) => message.info.summary && message.info.finish),
  )
  checks.push("actual-compaction-refreshes-context")
  const newSession = await create()
  assert.match(await prompt(newSession), /GLOBAL_ADDED_LATER/)
  await flush(newSession)
  await runtime.api(
    `/session/${newSession}`,
    { permission: [{ permission: "read", pattern: workspace.path, action: "deny" }] },
    "PATCH",
  )
  assert.doesNotMatch(await prompt(newSession), /WORKSPACE_MANUAL/)
  await flush(newSession)
  checks.push("cached-context-permission-revocation")
  checks.push("v2-context-injection", "stable-prefix-within-epoch", "new-session-sees-new-notes", "legacy-isolation")
  await forget(id, first.path)
  assert.doesNotMatch(await prompt(id), /GLOBAL_MANUAL_FIRST/)
  await flush(id)
  assert.ok(!(await list(id)).some((note) => note.path === first.path))
  checks.push("delete-invalidates-persisted-context")
  extraction.content = "OLD_CAPTURE_AFTER_CLEAR_MUST_NOT_RETURN"
  extraction.hold = Promise.withResolvers()
  const before = extraction.started
  await prompt(id, "This pre-clear turn must never be remembered after clearing.")
  await poll(() => extraction.started > before, "held capture")
  const oversized = {
    topic: join(dirname(dirname(dirname(workspace.path))), "topics", "large.md"),
    archive: join(dirname(dirname(dirname(workspace.path))), "archive", "large.md"),
    index: join(dirname(dirname(dirname(workspace.path))), "MEMORY.md"),
    global: join(dirname(dirname(dirname(first.path))), "topics", "large.md"),
  }
  if (large) {
    await Promise.all(
      Object.values(oversized).map((file) => writeFile(file, "# LARGE_MANUAL_NOTE\n" + "界😀".repeat(500000))),
    )
    const detail = await preview(id, oversized.global)
    assert.equal(detail.truncated, true)
    assert.equal(detail.deletable, false)
    assert.equal(detail.hash, null)
  }
  await clear()
  if (large) {
    assert.equal(await readFile(oversized.topic).catch(() => undefined), undefined)
    assert.equal(await readFile(oversized.archive).catch(() => undefined), undefined)
    assert.ok((await readFile(oversized.global)).length > 2 * 1024 * 1024)
    assert.ok((await readFile(oversized.index)).length <= 8192)
    checks.push("oversized-generated-index-rebuilt")
    checks.push(
      "large-topic-and-archive-clear",
      "workspace-clear-preserves-large-global",
      "large-preview-remains-bounded",
    )
  }
  assert.ok(!(await list(id)).some((note) => note.source === "workspace"))
  extraction.hold.resolve()
  extraction.hold = undefined
  extraction.content = ""
  assert.equal((await flush(id)).status, "completed")
  assert.ok(!(await list(id)).some((note) => note.source === "workspace"))
  assert.doesNotMatch(await prompt(id), /WORKSPACE_MANUAL|OLD_CAPTURE_AFTER_CLEAR/)
  await flush(id)
  assert.match(await readFile(second.path, "utf8"), /GLOBAL_MANUAL_EDITED/)
  assert.equal(await readFile(legacy, "utf8"), "LEGACY_KEEP")
  checks.push(
    "cli-selects-configured-v2-backend",
    "clear-fences-inflight-capture",
    "clear-prevents-historical-recapture",
    "clear-invalidates-open-session-context",
    "workspace-clear-preserves-global-and-legacy",
  )
  extraction.content = "FRESH_CAPTURE_AFTER_CLEAR"
  await prompt(id, "A new post-clear conversation can be remembered.")
  assert.equal((await flush(id)).status, "completed")
  assert.ok((await list(id)).some((note) => note.source === "workspace"))
  checks.push("fresh-capture-after-clear")
  extraction.content = ""
  const denied = await create({ permission: [{ permission: "read", pattern: "*", action: "deny" }] })
  assert.deepEqual(await list(denied), [])
  const readonly = await create({ permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
  assert.equal(await status(readonly, "/remember", { content: "DENIED_WRITE" }), 403)
  await runtime.api(`${endpoint(id)}/toggle`, { enabled: false })
  assert.equal(await status(id, "/remember", { content: "DISABLED_WRITE" }), 403)
  assert.equal(await status(id, ""), 403)
  checks.push("read-and-edit-permissions", "disabled-mode-blocks-management")
  await clear("--all")
  if (large) {
    assert.equal(await readFile(oversized.global).catch(() => undefined), undefined)
    checks.push("all-scope-clear-removes-large-global")
  }
  await runtime.api(`${endpoint(id)}/toggle`, { enabled: true })
  assert.deepEqual(await list(id), [])
  await runtime.api("/instance/dispose", undefined, "POST")
  assert.deepEqual(await list(id), [])
  assert.equal(await readFile(legacy, "utf8"), "LEGACY_KEEP")
  checks.push("all-scope-clear", "cleared-data-stays-absent-after-reopen")
  console.log(JSON.stringify({ kind, checks, passed: checks.length, output: runtime.output }, null, 2))
} finally {
  extraction.hold?.resolve()
  await writeFile(
    join(runtime.output, "memory-v2-management.json"),
    JSON.stringify({ checks, contexts, commands }, null, 2),
  )
  await runtime.close()
  console.error(`Memory V2 management evidence: ${runtime.output}`)
}
