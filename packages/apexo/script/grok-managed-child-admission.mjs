// Real native Workflow and HTTP admission boundaries; no synthetic routes or model loops.
import assert from "node:assert/strict"
import { access, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const hold = Promise.withResolvers()
const calls = []
const checks = []
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  config: { snapshot: false, compaction: { auto: false } },
  next: async ({ body, text }) => {
    calls.push(body)
    assert.ok(!JSON.stringify(body).includes("UNOWNED_INJECTION"))
    if (text.includes("OWNED_WORKFLOW_CHILD")) await hold.promise
    return { content: text.includes("OWNED_WORKFLOW_CHILD") ? "OWNED_DONE" : "ORDINARY_DONE" }
  },
})
const reject = async (endpoint, payload, status) => {
  const response = await fetch(`${fixture.url}${endpoint}?directory=${encodeURIComponent(fixture.directory)}`, {
    method: "POST",
    ...(payload === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.text()
  assert.equal(response.status, status, `${endpoint}: ${body}`)
  return body
}
try {
  await writeFile(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  const parent = (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const workflow = await fixture.api(`/api/session/${parent.id}/workflow`, {
    source: {
      type: "definition",
      definition: {
        name: "managed-admission",
        description: "Owned child input",
        stages: [{ name: "child", prompt: "OWNED_WORKFLOW_CHILD", readOnly: true }],
      },
    },
    agentBudget: 1,
  })
  const target = `/api/session/${parent.id}/workflow/${workflow.id}`
  const running = await poll(async () => {
    const info = await fixture.api(target)
    return calls.length === 1 && info.children.length === 1 ? info : undefined
  }, "owned child provider admission")
  const child = running.children[0]
  // The public metadata setter remains supported; it must not remove private ownership.
  await fixture.api(`/session/${child}`, { metadata: {} }, "PATCH")
  const before = await fixture.api(`/api/session/${child}/message`)
  assert.match(
    await reject(`/api/session/${child}/prompt`, { prompt: { text: "UNOWNED_INJECTION" }, resume: false }, 409),
    /owner|managed/i,
  )
  await reject(`/api/session/${child}/side-question`, { question: "UNOWNED_INJECTION" }, 400)
  await reject(
    `/api/session/${child}/goal`,
    { id: "goal_managedrefusal", objective: "UNOWNED_INJECTION", tokenBudget: 1000 },
    409,
  )
  await reject(
    `/api/session/${child}/workflow`,
    {
      source: {
        type: "definition",
        definition: {
          name: "forbidden",
          description: "Forbidden",
          stages: [{ name: "child", prompt: "UNOWNED_INJECTION" }],
        },
      },
    },
    400,
  )
  const forbidden = join(fixture.directory, "must-not-exist")
  await reject(`/session/${child}/message`, { parts: [{ type: "text", text: "UNOWNED_INJECTION" }] }, 400)
  await reject(`/session/${child}/prompt_async`, { parts: [{ type: "text", text: "UNOWNED_INJECTION" }] }, 400)
  await reject(`/session/${child}/command`, { command: "init", arguments: "UNOWNED_INJECTION" }, 400)
  await reject(`/session/${child}/shell`, { agent: "build", command: `touch '${forbidden}'` }, 400)
  await reject(`/session/${child}/summarize`, { providerID: "xai", modelID: "grok-4.7" }, 400)
  assert.deepEqual(await fixture.api(`/api/session/${child}/message`), before)
  assert.deepEqual(await fixture.api(`/api/session/${child}/side-question`), [])
  assert.equal(await fixture.api(`/api/session/${child}/goal`), null)
  assert.deepEqual(await fixture.api(`/api/session/${child}/workflow`), [])
  await assert.rejects(access(forbidden))
  assert.equal(calls.length, 1)
  checks.push("active-private-child-rejects-native-and-compat-admission-after-metadata-removal")
  hold.resolve()
  const complete = await poll(async () => {
    const info = await fixture.api(target)
    return info.status === "completed" ? info : undefined
  }, "owned Workflow settlement")
  assert.equal(complete.result, "OWNED_DONE")
  await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
  const settled = await fixture.api(`/api/session/${child}/message`)
  assert.equal(settled.data.filter((message) => message.type === "user").length, 1)
  await reject(`/api/session/${child}/compact`, undefined, 503)
  assert.equal(calls.length, 1)
  checks.push("one-owned-input-one-provider-drain-and-manual-compaction-refusal")
  await fixture.crash()
  await fixture.reopen()
  await reject(`/api/session/${child}/prompt`, { prompt: { text: "UNOWNED_INJECTION" }, resume: false }, 409)
  await reject(`/session/${child}/message`, { parts: [{ type: "text", text: "UNOWNED_INJECTION" }] }, 400)
  assert.deepEqual(await fixture.api(`/api/session/${child}/message`), settled)
  assert.equal(calls.length, 1)
  checks.push("restart-preserves-private-ownership-without-provider-replay")
  await fixture.api(`/api/session/${child}`, undefined, "DELETE")
  await fixture.api("/api/session", { id: child, location: parent.location, model: parent.model, agent: "build" })
  await fixture.api(`/api/session/${child}/prompt`, { prompt: { text: "ORDINARY_INPUT" } })
  await fixture.api(`/api/session/${child}/wait`, undefined, "POST")
  assert.equal(calls.length, 2)
  assert.ok(JSON.stringify(await fixture.api(`/api/session/${child}/message`)).includes("ORDINARY_DONE"))
  checks.push("deleted-child-id-can-be-reused-as-an-ordinary-session")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  hold.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "managed-child-admission.json"), JSON.stringify({ checks, calls }, null, 2))
}
