// Native CLI/Electron backend acceptance; installed reference is a separate evidence set.
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const runs = []
const requests = []
let current
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, input, finished, ancillary }) => {
    requests.push({ body, input, finished, ancillary })
    const tools = (body.tools ?? []).map((tool) => tool.function ?? tool)
    const title = tools.some((tool) => tool.name === "session_title")
    const content = (value) =>
      typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part.text ?? "").join("\n") : ""
    const dashboard = input.some(
      (item) => item.role === "system" && content(item.content).includes("ultra-short dashboard line"),
    )
    if (ancillary || title || dashboard) return { content: "Task delivery fixture" }
    assert.ok(
      tools.some((tool) => tool.name === "bash"),
      "Known native conversation tool catalog",
    )
    const users = input
      .filter((item) => item.role === "user")
      .map((item) => content(item.content))
      .filter((text) => !text.startsWith("<system-update>") && !text.startsWith("<active-task-reminder>"))
    const parent = users[0] === "DELIVERY_ROOT_OWNED"
    if (!parent && users[0] === "DELIVERY_CHILD_OWNED") {
      current.childCalls++
      if (current.childCalls === 1) {
        current.arrived.resolve()
        await current.release.promise
        return { content: "CHILD_INITIAL_OWNED" }
      }
      assert.equal(users.at(-1), "CORRECTION_OWNED")
      assert.equal(users.filter((text) => text === "CORRECTION_OWNED").length, 1)
      return { content: "CHILD_CORRECTED_OWNED" }
    }
    assert.ok(parent, "Exact current conversation user identity")
    if (!current.spawned) {
      current.spawned = true
      return {
        tool: "task",
        args: {
          description: "Owned delivery",
          prompt: "DELIVERY_CHILD_OWNED",
          subagent_type: "helper",
          background: true,
        },
      }
    }
    return { content: "PARENT_SETTLED_OWNED" }
  },
})
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      task: { activeMessages: true },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "grok-4.7": {
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  for (const delivery of ["steer", "queue", "interject"]) {
    current = { delivery, childCalls: 0, arrived: Promise.withResolvers(), release: Promise.withResolvers() }
    const parent = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "DELIVERY_ROOT_OWNED" } })
    await deadline(current.arrived.promise, 15000, "actual child provider arrival")
    const list = await fixture.api(`/api/session/${parent.id}/task`)
    assert.equal(list.length, 1)
    const child = list[0].id
    const input = { inputID: `msg_delivery${delivery}`, text: "CORRECTION_OWNED", delivery }
    const route = `/api/session/${parent.id}/task/${child}/message`
    const admitted = await fixture.api(route, input)
    assert.equal(admitted.status, "admitted")
    assert.deepEqual(await fixture.api(route, input), admitted)
    current.release.resolve()
    await poll(
      async () => (await fixture.api(`/api/session/${parent.id}/task/${child}`)).status === "completed",
      "child completion",
      20000,
    )
    await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
    assert.equal((await fixture.api(`${route}/${input.inputID}`)).status, "promoted")
    assert.equal((await fixture.api(`/api/session/${parent.id}/task/${child}`)).output, "CHILD_CORRECTED_OWNED")
    assert.equal(current.childCalls, 2)
    runs.push({ delivery, childCalls: current.childCalls, receipt: "promoted", sameChild: child })
  }
  await writeFile(join(fixture.output, "task-delivery.json"), JSON.stringify(runs, null, 2))
  console.log(JSON.stringify({ kind: process.argv[2] ?? "cli", runs, output: fixture.output }))
} finally {
  current?.release.resolve()
  await fixture.close()
  await writeFile(join(fixture.output, "task-delivery-requests.json"), JSON.stringify(requests, null, 2))
  console.error(`Task delivery evidence: ${fixture.output}`)
}
