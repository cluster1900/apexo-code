import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const scenarios = []
const contexts = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  config: {
    memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { memory_flush: { enabled: false } },
  },
  next({ input, ancillary }) {
    if (!ancillary)
      contexts.push(
        input
          .filter((item) => item.role === "system")
          .map((item) =>
            typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
          )
          .join("\n")
          .match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? "",
      )
    return { content: "MEMORY_BROWSER_ACK" }
  },
})
async function prompt(sessionID) {
  const before = contexts.length
  await runtime.api(`/session/${sessionID}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Investigate database transaction retry boundaries." }],
  })
  assert.ok(contexts.length > before, "Expected a main provider request")
  return contexts.at(-1)
}
async function request(sessionID, suffix = "", body, search = {}, directory = runtime.directory) {
  const url = new URL(`/experimental/session/${sessionID}/memory${suffix}`, runtime.url)
  Object.entries({ directory, ...search }).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  })
  return { status: response.status, body: await response.json() }
}
try {
  const session = await runtime.api("/session", { title: "Memory browser parity" })
  const base = join(runtime.env.APEXO_TEST_HOME, ".grok", "memory")
  const root = join(
    base,
    `${basename(runtime.directory)}-${createHash("sha256").update(runtime.directory).digest("hex").slice(0, 8)}`,
  )
  await mkdir(join(root, "sessions"), { recursive: true })
  await mkdir(join(root, "topics"))
  const file = join(root, "topics", "database.md")
  await writeFile(join(base, "MEMORY.md"), "GLOBAL_KEEP")
  await writeFile(file, "# 数据库\nSQLITE_DATABASE_SAVED\n")
  await writeFile(join(root, "sessions", "recent.md"), "SESSION_KEEP")
  const capabilities = await runtime.api("/experimental/capabilities")
  assert.equal(capabilities.memoryManagement, true)
  const listed = await request(session.id)
  assert.equal(listed.status, 200, JSON.stringify(listed.body))
  assert.deepEqual(
    listed.body.map((note) => note.source),
    ["global", "workspace", "session"],
  )
  scenarios.push("grouped-list", "capability")
  const filtered = await request(session.id, "", undefined, { search: "database 数据库" })
  assert.equal(filtered.body.length, 1)
  assert.equal(filtered.body[0].path, await realpath(file))
  assert.deepEqual((await request(session.id, "", undefined, { search: "database missing" })).body, [])
  scenarios.push("filter-name-and-content-all-words", "empty-filter")
  const preview = await request(session.id, "/note", undefined, { path: file })
  assert.equal(preview.status, 200)
  assert.match(preview.body.content, /SQLITE_DATABASE_SAVED/)
  assert.equal(
    preview.body.hash,
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex"),
  )
  scenarios.push("preview-and-original-byte-hash")
  assert.match(await prompt(session.id), /SQLITE_DATABASE_SAVED/)
  scenarios.push("previewed-note-in-live-context")
  await writeFile(file, "EDITED_AFTER_PREVIEW")
  assert.equal((await request(session.id, "/forget", { path: file, hash: preview.body.hash })).status, 409)
  assert.equal(await readFile(file, "utf8"), "EDITED_AFTER_PREVIEW")
  scenarios.push("reject-changed-preview")
  assert.equal((await request(session.id, "/forget", { path: file, hash: "invalid" })).status, 400)
  scenarios.push("validate-hash")
  const current = await request(session.id, "/note", undefined, { path: file })
  assert.deepEqual(await request(session.id, "/forget", { path: file, hash: current.body.hash }), {
    status: 200,
    body: true,
  })
  assert.equal((await request(session.id, "/note", undefined, { path: file })).status, 404)
  assert.equal((await request(session.id)).body.length, 2)
  assert.equal(await readFile(join(base, "MEMORY.md"), "utf8"), "GLOBAL_KEEP")
  scenarios.push("delete-single-note", "missing-preview", "preserve-other-notes")
  assert.equal(await prompt(session.id), "", "Deleted notes must leave the active session's cached memory context")
  scenarios.push("delete-invalidates-live-context")
  await runtime.api("/instance/dispose", undefined, "POST")
  assert.equal(await prompt(session.id), "", "Deleted notes must not return from persisted context or the search index")
  scenarios.push("delete-remains-absent-after-instance-reload")
  await writeFile(file, "x".repeat(256 * 1024 + 1))
  const large = await request(session.id, "/note", undefined, { path: file })
  assert.equal(large.body.truncated, true)
  assert.equal(large.body.hash, null)
  assert.equal(large.body.deletable, false)
  assert.equal(large.body.content.length, 256 * 1024)
  assert.equal((await request(session.id, "/forget", { path: file, hash: "a".repeat(64) })).status, 409)
  scenarios.push("large-preview", "reject-large-delete")
  const unrelated = join(runtime.output, "unrelated")
  await mkdir(unrelated)
  assert.equal((await request(session.id, "", undefined, {}, unrelated)).status, 404)
  assert.equal((await request(session.id, "/note", undefined, { path: join(unrelated, "outside.md") })).status, 403)
  scenarios.push("session-project-isolation", "path-scope-isolation")
  const outside = join(unrelated, "outside.md")
  await writeFile(outside, "DO_NOT_DELETE")
  const link = join(root, "topics", "link.md")
  await symlink(outside, link)
  assert.ok(!(await request(session.id)).body.some((note) => note.name === "topics/link.md"))
  assert.equal((await request(session.id, "/forget", { path: link, hash: "a".repeat(64) })).status, 503)
  assert.equal(await readFile(outside, "utf8"), "DO_NOT_DELETE")
  scenarios.push("symlink-hidden-and-refused")
  const denied = await runtime.api("/session", {
    title: "Read denied",
    permission: [{ permission: "read", pattern: "*", action: "deny" }],
  })
  assert.deepEqual((await request(denied.id)).body, [])
  assert.equal((await request(denied.id, "/note", undefined, { path: file })).status, 403)
  const readonly = await runtime.api("/session", {
    title: "Edit denied",
    permission: [{ permission: "edit", pattern: "*", action: "deny" }],
  })
  await writeFile(file, "READONLY")
  const protectedNote = await request(readonly.id, "/note", undefined, { path: file })
  assert.equal(protectedNote.body.deletable, false)
  assert.equal((await request(readonly.id, "/forget", { path: file, hash: protectedNote.body.hash })).status, 403)
  scenarios.push("read-permission", "edit-permission")
  console.log(JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", output: runtime.output, scenarios }))
} finally {
  await writeFile(join(runtime.output, "memory-browser.json"), JSON.stringify({ scenarios }, null, 2))
  await runtime.close()
}
