// Apexo-owned completed-child wake acceptance. Installed reference runs separately.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const runs = []
const requests = []
let current
const content = (value) =>
  typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part.text ?? "").join("\n") : ""
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, input, ancillary }) => {
    const tools = (body.tools ?? []).map((tool) => tool.function ?? tool)
    if (
      ancillary ||
      tools.some((tool) => tool.name === "session_title") ||
      input.some((item) => item.role === "system" && content(item.content).includes("ultra-short dashboard line"))
    )
      return { content: "Task wake fixture" }
    const users = input.filter((item) => item.role === "user").map((item) => content(item.content))
    requests.push({ body, users })
    if (users[0] === "WAKE_CHILD_FIRST") {
      current.childCalls++
      if (current.childCalls === 1) return { content: "WAKE_CHILD_FIRST_FINISHED" }
      assert.equal(current.childCalls, 2)
      assert.equal(users.at(-1), "WAKE_CHILD_SECOND")
      assert.equal(users.filter((text) => text === "WAKE_CHILD_SECOND").length, 1)
      return { content: "WAKE_CHILD_SECOND_FINISHED" }
    }
    assert.equal(users[0], "WAKE_ROOT_OWNED")
    current.parentCalls++
    if (current.parentCalls === 1)
      return {
        tool: "task",
        args: { description: "Wake child", prompt: "WAKE_CHILD_FIRST", subagent_type: "helper" },
      }
    const returned = input.findLast((item) => item.role === "tool" || item.type === "function_call_output")
    const result = JSON.parse(content(returned?.type === "function_call_output" ? returned.output : returned?.content))
    if (current.parentCalls === 2) {
      assert.equal(result.status, "completed")
      current.childID = result.id
      return { content: "WAKE_PARENT_IDLE" }
    }
    return { content: "WAKE_PARENT_FINISHED" }
  },
})
const messages = async (sessionID) => {
  const url = new URL(`/api/session/${sessionID}/message`, fixture.url)
  url.searchParams.set("order", "asc")
  url.searchParams.set("directory", fixture.directory)
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  assert.ok(response.ok, `Chronological transcript returned ${response.status}`)
  return response.json()
}
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
    current = { delivery, childCalls: 0, parentCalls: 0 }
    const parent = (
      await fixture.api("/api/session", {
        location: { directory: fixture.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "WAKE_ROOT_OWNED" } })
    await poll(
      async () => {
        const history = await messages(parent.id)
        return history.data.some(
          (message) =>
            message.type === "assistant" &&
            message.time.completed &&
            message.content.some((part) => part.type === "text" && part.text === "WAKE_PARENT_IDLE"),
        )
      },
      "parent observed woken child completion",
      20000,
    )
    await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
    const route = `/api/session/${parent.id}/task/${current.childID}/message`
    const first = await fixture.api(`/api/session/${parent.id}/task/${current.childID}`)
    assert.equal(first.status, "completed")
    const input = { inputID: `msg_operator${randomUUID().replaceAll("-", "")}`, text: "WAKE_CHILD_SECOND", delivery }
    const accepted = await fixture.api(route, input)
    assert.equal(accepted.taskID, current.childID)
    await poll(
      async () =>
        (await fixture.api(`/api/session/${parent.id}/task/${current.childID}`)).output ===
        "WAKE_CHILD_SECOND_FINISHED",
      "operator woke completed child",
      20000,
    )
    await poll(
      async () =>
        (await messages(parent.id)).data.some(
          (message) =>
            message.type === "assistant" &&
            message.time.completed &&
            message.content.some((part) => part.type === "text" && part.text === "WAKE_PARENT_FINISHED"),
        ),
      "operator completion surfaced",
      20000,
    )
    await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
    const before = await fixture.api(`/api/session/${parent.id}/task/${current.childID}`)
    assert.equal((await fixture.api(route, input)).status, "promoted")
    assert.deepEqual(await fixture.api(`/api/session/${parent.id}/task/${current.childID}`), before)
    const history = await messages(current.childID)
    assert.deepEqual(
      history.data.filter((message) => message.type === "user").map((message) => message.text),
      ["WAKE_CHILD_FIRST", "WAKE_CHILD_SECOND"],
    )
    assert.equal(current.childCalls, 2)
    assert.equal(current.parentCalls, 3)
    runs.push({
      delivery,
      sameChild: current.childID,
      childCalls: current.childCalls,
      parentCalls: current.parentCalls,
      receipt: "promoted",
    })
  }
  await writeFile(join(fixture.output, "task-operator-wake.json"), JSON.stringify(runs, null, 2))
  console.log(JSON.stringify({ kind: process.argv[2] ?? "cli", runs, output: fixture.output }))
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "task-operator-wake-requests.json"), JSON.stringify(requests, null, 2))
  console.error(`Task wake evidence: ${fixture.output}`)
}
