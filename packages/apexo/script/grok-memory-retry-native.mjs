// Server-derived retry preserves the original private receipt across a real backend restart.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const calls = { provider: 0 }
const fixture = await startShellFixture(kind, {
  next() {
    calls.provider++
    throw new Error("Management must not launch a provider")
  },
})
const checks = []
const operation = () => `mop_${randomUUID()}`
const request = async (route, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
  const response = await fetch(new URL(route, fixture.url), {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${method} ${route}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const settled = (root, id) =>
  poll(
    async () => {
      const value = await request(`${root}/operation/${id}`)
      return value.state === "finished" ? value : undefined
    },
    "recovery operation settled",
    20000,
  )
try {
  const baseURL = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  const configuration = {
    snapshots: false,
    memory_v2: { enabled: true, automatic_dream_enabled: false },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers: {
      xai: {
        api: { type: "aisdk", package: "@ai-sdk/xai", url: baseURL, settings: { apiKey: "fixture" } },
        models: {
          "grok-4.7": {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 4096 },
          },
        },
      },
    },
  }
  await writeFile(join(fixture.directory, "apexo.json"), JSON.stringify(configuration))
  const create = () =>
    request("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    }).then((value) => value.data)
  const operator = await create()
  const original = await create()
  const root = `/api/session/${operator.id}/memory`
  assert.equal((await request(`${root}/recovery?scope=workspace&action=clear`)).reason, "scope_empty")
  assert.equal(calls.provider, 0)
  checks.push("passive-missing-scope-no-provider")
  const location = await request(`/api/location?location[directory]=${encodeURIComponent(fixture.directory)}`)
  assert.equal(location.directory, operator.location.directory)
  await fixture.crash()
  const output = join(fixture.output, "recovery-seed.json")
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("./grok-memory-recovery-seed.mjs", import.meta.url))],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...fixture.env, APEXO_RECOVERY_SEED_OUTPUT: output },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  child.stdin.write(
    JSON.stringify({
      home: fixture.env.APEXO_TEST_HOME,
      directory: location.directory,
      projectID: location.project.id,
      sessionID: original.id,
    }),
  )
  child.stdin.end()
  const logs = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  try {
    assert.equal(await deadline(child.exited, 30000, "Memory recovery seed"), 0, (await logs).join("\n"))
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
    await logs
  }
  const seed = JSON.parse(await Bun.file(output).text())
  await fixture.reopen()
  await request(`/api/session/${original.id}`, undefined, "DELETE", 204)
  const discard = await request(`${root}/recovery?scope=workspace&action=discard`)
  assert.equal(discard.available, true)
  assert.ok(!JSON.stringify(discard).includes(seed.lease.token))
  assert.ok(!JSON.stringify(discard).includes(seed.root))
  const discardID = operation()
  await request(`${root}/recovery`, { id: discardID, preview: discard })
  const discarded = await settled(root, discardID)
  assert.deepEqual(discarded.recovery, { action: "discard", scope: "workspace" })
  assert.equal(discarded.result.status, "completed")
  assert.equal(discarded.result.committed, true)
  assert.equal(await Bun.file(join(seed.root, "topics", "must-not-publish.md")).exists(), false)
  assert.match(await Bun.file(seed.note).text(), /Preserved source/)
  checks.push("deleted-session-released-plan-discard-never-replays")
  const stale = await request(`${root}/recovery?scope=workspace&action=clear`)
  await Bun.write(seed.note, "Changed external knowledge")
  const staleID = operation()
  await request(`${root}/recovery`, { id: staleID, preview: stale }, "POST", 409)
  await request(`${root}/operation/${staleID}`, undefined, "GET", 404)
  assert.equal(await Bun.file(seed.note).text(), "Changed external knowledge")
  checks.push("changed-preview-refuses-before-admission")
  const clear = await request(`${root}/recovery?scope=workspace&action=clear`)
  const clearID = operation()
  await request(`${root}/recovery`, { id: clearID, preview: clear })
  assert.equal((await settled(root, clearID)).result.status, "completed")
  assert.equal(await Bun.file(seed.note).exists(), false)
  assert.match(await Bun.file(seed.global).text(), /Unrelated global knowledge/)
  checks.push("explicit-clear-preserves-unrelated-scope")
  await fixture.crash()
  await fixture.reopen()
  await request(`${root}/recovery`, { id: clearID, preview: clear })
  await request(`${root}/recovery`, { id: discardID, preview: discard })
  assert.equal((await request(`${root}/operation/${clearID}`)).result.committed, true)
  assert.equal(calls.provider, 0)
  checks.push("restart-and-exact-retry-no-provider")
  const stranger = await create()
  const fresh = join(seed.root, "observations", "after-clear.md")
  await Bun.write(fresh, "New knowledge after committed clear")
  await fixture.crash()
  await fixture.reopen()
  const retryID = operation()
  const retryBody = { id: retryID, retryOf: clearID }
  await request(`${root}/retry`, retryBody)
  const retried = await settled(root, retryID)
  assert.equal(retried.result.status, "completed")
  assert.equal(retried.result.committed, true)
  assert.equal(retried.retryOf, clearID)
  assert.deepEqual(retried.recovery, { action: "clear", scope: "workspace" })
  assert.equal(await Bun.file(fresh).text(), "New knowledge after committed clear")
  assert.ok(!JSON.stringify(retried).includes(seed.root))
  assert.ok(!JSON.stringify(retried).includes(seed.lease.token))
  assert.equal("plan" in retried, false)
  assert.equal("preview" in retried, false)
  checks.push("reopened-server-derived-committed-retry-preserves-new-files")
  const again = await request(`${root}/retry`, retryBody)
  assert.equal(again.state, "finished")
  assert.equal(again.result.committed, true)
  assert.equal(await Bun.file(fresh).text(), "New knowledge after committed clear")
  checks.push("exact-retry-reconciles-without-private-request-on-wire")
  const foreignID = operation()
  const foreignRoot = `/api/session/${stranger.id}/memory`
  await request(`${foreignRoot}/retry`, { id: foreignID, retryOf: clearID }, "POST", 404)
  await request(`${foreignRoot}/operation/${foreignID}`, undefined, "GET", 404)
  checks.push("cross-session-retry-refused-before-admission")
  await request(`/api/session/${operator.id}`, undefined, "DELETE", 204)
  await request("/api/session", {
    id: operator.id,
    location: { directory: fixture.directory },
    model: { providerID: "xai", id: "grok-4.7" },
  })
  const replacedID = operation()
  await request(`${root}/retry`, { id: replacedID, retryOf: clearID }, "POST", 404)
  await request(`${root}/operation/${replacedID}`, undefined, "GET", 404)
  assert.equal(await Bun.file(fresh).text(), "New knowledge after committed clear")
  assert.equal(calls.provider, 0)
  checks.push("recreated-session-cannot-retry-original-receipt-zero-provider")
  console.log(
    JSON.stringify(
      { result: "pass", runtime: kind, checks, providerCalls: calls.provider, output: fixture.output },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
  console.error(`Retry fixture output: ${fixture.output}`)
}
