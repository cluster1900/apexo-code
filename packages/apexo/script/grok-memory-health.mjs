// Production HTTP API and CLI command share content-free Memory V2 diagnostics.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind, {
  config: { memory_v2: { enabled: true, capture_enabled: false, automatic_dream_enabled: false } },
  next: () => ({ content: "HEALTH_MODEL_MUST_NOT_RUN" }),
})
const checks = []
try {
  const session = await runtime.api("/session", { title: "Memory health parity" })
  const endpoint = `/experimental/session/${session.id}/memory`
  const initial = await runtime.api(`${endpoint}/health`)
  assert.equal(initial.backend, "v2")
  assert.equal(initial.enabled, true)
  assert.ok(initial.scopes.every((scope) => scope.state === "empty"))
  checks.push("uninitialized-scopes-remain-empty")
  const note = await runtime.api(`${endpoint}/remember`, { content: "PRIVATE_MEMORY_HEALTH_NOTE", scope: "workspace" })
  const saved = await readFile(note.path, "utf8")
  const root = dirname(dirname(dirname(note.path)))
  const before = await readFile(join(root, "MEMORY.md"), "utf8")
  const health = await runtime.api(`${endpoint}/health`)
  assert.equal(health.scopes[0].state, "ready")
  assert.equal(health.scopes[0].snapshot.pendingObservations, 1)
  assert.equal(health.scopes[0].snapshot.dreamLease, "none")
  assert.equal(health.scopes[1].state, "empty")
  assert.ok(!JSON.stringify(health).includes("PRIVATE_MEMORY"))
  checks.push("workspace-counts", "global-isolation", "content-free-response")
  const command = await promisify(execFile)("bun", [resolve("src/index.ts"), "memory", "status", "--all", "--json"], {
    cwd: runtime.directory,
    env: runtime.env,
    timeout: 45000,
  })
  assert.deepEqual(JSON.parse(command.stdout).scopes, health.scopes)
  checks.push("standalone-cli-matches-http-scopes")
  assert.equal(await readFile(note.path, "utf8"), saved)
  assert.equal(await readFile(join(root, "MEMORY.md"), "utf8"), before)
  assert.equal(runtime.calls.length, 0)
  checks.push("diagnostics-do-not-rewrite-notes-or-run-model")
  await runtime.api(`${endpoint}/toggle`, { enabled: false })
  assert.deepEqual(await runtime.api(`${endpoint}/health`), { backend: "v2", enabled: false, scopes: [] })
  checks.push("disabled-session-hides-scopes")
  const denied = await runtime.api("/session", {
    title: "Health denied",
    permission: [{ permission: "read", pattern: "*", action: "deny" }],
  })
  assert.ok(
    (await runtime.api(`/experimental/session/${denied.id}/memory/health`)).scopes.every(
      (scope) => scope.state === "denied",
    ),
  )
  checks.push("denied-is-distinct-from-empty")
  await writeFile(
    join(runtime.output, "memory-health-evidence.json"),
    JSON.stringify({ checks, health, command }, null, 2),
  )
  console.log(JSON.stringify({ kind, output: runtime.output, checks, passed: checks.length }, null, 2))
} finally {
  await runtime.close()
}
