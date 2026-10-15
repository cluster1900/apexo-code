// Real CLI/Desktop project bootstrap reads; no model request is needed.
import assert from "node:assert/strict"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const runtime = await startShellFixture(kind, { config: { snapshot: false } })
const checks = []
const api = async (pathname, body) => {
  const url = new URL(pathname, runtime.url)
  if (pathname !== "/api/project") url.searchParams.set("location[directory]", runtime.directory)
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  assert.equal(response.status, 200, `${pathname}: ${response.status} ${text}`)
  return JSON.parse(text)
}
try {
  const location = await api("/api/location")
  const current = await api("/api/project/current")
  assert.deepEqual(current, location.project)
  assert.equal(typeof current.id, "string")
  assert.ok(current.directory.startsWith("/"))
  checks.push("current-project-uses-authoritative-location-identity")

  const session = (await api("/api/session", { location: { directory: runtime.directory } })).data
  assert.equal(session.projectID, current.id)
  assert.equal(session.location.directory, runtime.directory)
  checks.push("native-session-creation-uses-the-same-project")

  const projects = await api("/api/project")
  const project = projects.find((project) => project.id === current.id)
  assert.ok(project)
  assert.equal(project.worktree, current.directory)
  assert.ok(project.time.created > 0)
  assert.ok(Array.isArray(project.sandboxes))
  assert.equal(runtime.calls.length, 0)
  checks.push("project-catalog-returns-persisted-metadata-without-model-work")

  await runtime.crash()
  await runtime.reopen()
  assert.deepEqual(await api("/api/project/current"), current)
  const restored = (await api("/api/project")).find((project) => project.id === current.id)
  assert.deepEqual(restored, project)
  assert.equal(runtime.calls.length, 0)
  checks.push("catalog-and-current-identity-survive-process-restart")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, providerCalls: runtime.calls.length }))
} finally {
  await runtime.close()
}
