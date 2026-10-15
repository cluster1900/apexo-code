import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { MemoryFilesystem } from "@apexo/core/memory-filesystem"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { startShellFixture } from "./grok-shell-fixture.mjs"
import { mountWebDAV } from "./grok-memory-webdav.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind, {
  env: { GROK_SQLITE_JOURNAL_MODE: "wal" },
  config: { memory_v2: { enabled: true, capture_enabled: false, automatic_dream_enabled: false } },
})
const root = MemoryV2.directory({ home: runtime.env.APEXO_TEST_HOME, directory: runtime.directory, scope: "global" })
const state = { mount: undefined }
const checks = []
try {
  state.mount = await mountWebDAV(root)
  assert.equal(await MemoryFilesystem.network(root), true)
  checks.push("actual-webdav-mount-detected")
  const session = await runtime.api("/session", { title: "Network filesystem isolation" })
  const endpoint = `/experimental/session/${session.id}/memory`
  await assert.rejects(
    runtime.api(`${endpoint}/remember`, { content: "MUST_NOT_SAVE", scope: "global" }),
    /local filesystem/,
  )
  await assert.rejects(runtime.api(endpoint), /local filesystem/)
  checks.push("forced-wal-cannot-bypass-mounted-network-scope", "network-list-and-save-rejected")
  const local = await runtime.api(`${endpoint}/remember`, { content: "LOCAL_SCOPE_STILL_WORKS", scope: "workspace" })
  assert.equal(await readFile(local.path, "utf8"), "LOCAL_SCOPE_STILL_WORKS")
  checks.push("separate-local-workspace-still-writable")
  const health = await runtime.api(`${endpoint}/health`)
  assert.equal(health.scopes[0].state, "ready")
  assert.deepEqual(health.scopes[1], { scope: "global", state: "unavailable", reason: "storage" })
  checks.push("mounted-network-diagnostic-is-unavailable")
  await assert.rejects(
    promisify(execFile)("bun", [resolve("src/index.ts"), "memory", "clear", "--backend", "v2", "--global", "--yes"], {
      env: runtime.env,
      cwd: runtime.directory,
      timeout: 30000,
    }),
    /local filesystem/,
  )
  assert.equal(await readFile(local.path, "utf8"), "LOCAL_SCOPE_STILL_WORKS")
  checks.push("network-clear-refused-local-note-preserved")
  assert.ok(state.mount.requests.some((request) => request.method === "PROPFIND"))
  assert.ok(state.mount.requests.every((request) => ["OPTIONS", "PROPFIND", "HEAD", "GET"].includes(request.method)))
  assert.equal(runtime.calls.length, 0)
  checks.push("no-remote-write-or-model-call")
} finally {
  const requests = state.mount?.requests ?? []
  await (state.mount ? state.mount.close() : Promise.resolve()).finally(() => runtime.close())
  await writeFile(join(runtime.output, "memory-filesystem-mounted.json"), JSON.stringify({ checks, requests }, null, 2))
}
assert.deepEqual(await readdir(root), [])
checks.push("temporary-mount-cleaned-up")
await writeFile(
  join(runtime.output, "memory-filesystem-mounted.json"),
  JSON.stringify({ checks, requests: state.mount.requests }, null, 2),
)
console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }, null, 2))
