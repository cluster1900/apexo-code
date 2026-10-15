// Native CLI/Desktop Plan and the real App API adapter; all model work is local fixture traffic.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
// The App is typechecked in its own package; resolve its actual runtime adapter here without importing its @/* aliases into Apexo's TypeScript project.
const compatModule = new URL("../../app/src/utils/server-compat.ts", import.meta.url).href
const serverModule = new URL("../../app/src/utils/server.ts", import.meta.url).href
const { createCompatibleApi } = await import(compatModule)
const { createApiForServer, createSdkForServer } = await import(serverModule)

const kind = process.argv[2] ?? "cli"
const checks = []
const evidence = []
for (const answer of ["Approve", "Keep planning"]) {
  let stage = 0
  const runtime = await startShellFixture(kind, {
    config: { snapshot: false },
    next: ({ body }) => {
      stage += 1
      if (stage === 1) return { tool: "plan_enter", args: {} }
      if (stage === 2) {
        const filename = JSON.stringify(body).match(/Draft the plan at ([^;]+);/)?.[1]
        assert.ok(filename)
        const tools = body.tools.map((tool) => tool.function ?? tool)
        assert.ok(!tools.some((tool) => ["task", "workflow"].includes(tool.name)))
        return { tool: "write", args: { path: filename, content: `PLAN_REVIEW_${answer}` } }
      }
      if (stage === 3) return { tool: "plan_exit", args: {} }
      return { content: "NATIVE_PLAN_DONE" }
    },
  })
  try {
    await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
    const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(new URL(route, runtime.url), {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      })
      const content = await response.text()
      assert.ok(response.ok, `${route}: ${response.status} ${content}`)
      return content ? JSON.parse(content) : undefined
    }
    const session = (
      await request("/api/session", {
        location: { directory: runtime.directory },
        agent: "build",
        model: { providerID: "xai", id: "grok-4.7" },
      })
    ).data
    const root = `/api/session/${session.id}`
    await request(`${root}/prompt`, {
      id: `msg_plan_${answer.replaceAll(" ", "")}`,
      prompt: { text: "Prepare the plan, then ask for approval" },
    })
    const pending = await poll(async () => (await request(`${root}/question`)).data[0], "native Plan approval")
    assert.ok(pending.questions[0].question.includes(`PLAN_REVIEW_${answer}`))
    assert.equal((await request(root)).data.agent, "plan")
    assert.equal(runtime.calls.length, 3)
    checks.push(`${answer}: actual plan artifact is presented before switching`)

    await runtime.crash()
    await runtime.reopen()
    const restored = (await request(`${root}/question`)).data
    assert.deepEqual(restored, [pending])
    assert.equal(runtime.calls.length, 3)
    await request(`${root}/interrupt`, undefined, "POST")
    assert.deepEqual((await request(`${root}/question`)).data, [pending])
    assert.equal(runtime.calls.length, 3)
    checks.push(`${answer}: crash restores the exact pending review and idle Stop is a no-op`)

    const server = { url: runtime.url }
    const app = createCompatibleApi({
      protocol: Promise.resolve("v2"),
      current: createApiForServer({ server }),
      legacy: () => createSdkForServer({ server }),
      directory: runtime.directory,
    })
    await app.question.reply({ sessionID: session.id, requestID: pending.id, answers: [[answer]] })
    await request(`${root}/wait`, undefined, "POST")
    assert.equal((await request(root)).data.agent, answer === "Approve" ? "build" : "plan")
    assert.deepEqual((await request(`${root}/question`)).data, [])
    assert.equal((await request(`${root}/message?order=asc`)).data.filter((item) => item.type === "user").length, 1)
    assert.equal(runtime.calls.length, 4)
    checks.push(`${answer}: real App question adapter preserves the explicit answer`)
    await app.question.reply({ sessionID: session.id, requestID: pending.id, answers: [[answer]] })
    await request(`${root}/wait`, undefined, "POST")
    assert.equal(runtime.calls.length, 4)
    const conflict = await fetch(new URL(`${root}/question/${pending.id}/reply`, runtime.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [[answer === "Approve" ? "Keep planning" : "Approve"]] }),
    })
    assert.equal(conflict.status, 409)
    await conflict.text()
    checks.push(`${answer}: settled exact retry is inert and a conflicting answer is rejected`)
    await runtime.crash()
    await runtime.reopen()
    assert.equal((await request(root)).data.agent, answer === "Approve" ? "build" : "plan")
    assert.equal(runtime.calls.length, 4)
    checks.push(`${answer}: selected agent survives restart without provider work`)
    evidence.push({ answer, providerCalls: runtime.calls.length, output: runtime.output })
  } finally {
    await runtime.close()
  }
}
// A decision recorded for an earlier configuration never grants permission over a new hard deny.
{
  let stage = 0
  const runtime = await startShellFixture(kind, {
    config: { snapshot: false },
    next: () => {
      stage += 1
      return stage === 1
        ? { tool: "plan_enter", args: {} }
        : stage === 2
          ? { tool: "plan_exit", args: {} }
          : { content: "NO_UNAPPROVED_CONTINUATION" }
    },
  })
  try {
    const config = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT)
    await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify(config))
    const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(new URL(route, runtime.url), {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      })
      const text = await response.text()
      return { status: response.status, data: text ? JSON.parse(text) : undefined }
    }
    const created = await request("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
    assert.equal(created.status, 200)
    const root = `/api/session/${created.data.data.id}`
    assert.equal(
      (await request(`${root}/prompt`, { id: "msg_plan_newdeny", prompt: { text: "Prepare a plan for review" } }))
        .status,
      200,
    )
    const pending = await poll(async () => (await request(`${root}/question`)).data.data[0], "review before new denial")
    assert.equal(pending.questions[0].purpose, "plan_approval")
    await runtime.crash()
    config.permission = { "*": "allow", plan_exit: "deny" }
    await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify(config))
    await runtime.reopen()
    assert.equal((await request(`${root}/question/${pending.id}/reply`, { answers: [["Approve"]] })).status, 403)
    assert.equal((await request(root)).data.data.agent, "plan")
    assert.deepEqual((await request(`${root}/question`)).data.data, [pending])
    assert.equal(runtime.calls.length, 2)
    checks.push("recovered approval cannot override a new configured hard denial")
    assert.equal(
      (
        await request(`${root}/prompt`, {
          id: "msg_plan_pending_steer",
          prompt: { text: "A genuine later message waits for the review" },
        })
      ).status,
      200,
    )
    assert.equal((await request(`${root}/wait`, undefined, "POST")).status, 204)
    assert.equal(runtime.calls.length, 2)
    assert.deepEqual((await request(`${root}/question`)).data.data, [pending])
    checks.push("pending review blocks advisory prompt wakes without losing the question")
    assert.equal((await request(`${root}/question/${pending.id}/reject`, undefined, "POST")).status, 204)
    assert.deepEqual((await request(`${root}/question`)).data.data, [])
    assert.equal(runtime.calls.length, 2)
    checks.push("explicit dismissal clears recovered review without scheduling provider work")
    evidence.push({ answer: "new hard denial", providerCalls: runtime.calls.length, output: runtime.output })
  } finally {
    await runtime.close()
  }
}

console.log(
  JSON.stringify(
    {
      kind,
      passed: checks.length,
      checks,
      providerCalls: evidence.reduce((sum, item) => sum + item.providerCalls, 0),
      evidence,
    },
    null,
    2,
  ),
)
