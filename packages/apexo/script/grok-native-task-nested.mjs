// Native nested Task acceptance against a real CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const calls = [],
  checks = [],
  owned = {}
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ body, input, text, finished, ancillary }) => {
    if (ancillary) return { content: "Fixture title" }
    calls.push({ text, finished })
    const tools = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    if (text.includes("NESTED_LEAF")) {
      assert.ok(!tools.includes("task"))
      return { content: "LEAF_RESULT" }
    }
    if (text.includes("NESTED_CHILD") || text.includes("NESTED_FOLLOWUP")) {
      assert.ok(tools.includes("task"))
      return finished
        ? { content: "CHILD_RESULT" }
        : { tool: "task", args: { description: "Grandchild", prompt: "NESTED_LEAF", subagent_type: "helper" } }
    }
    if (text.includes("DEFAULT_CHILD")) {
      assert.ok(!tools.includes("task"))
      return { content: "DEFAULT_CHILD_RESULT" }
    }
    if (!finished)
      return {
        tool: "task",
        args: {
          description: "Root child",
          prompt: text.includes("ROOT_DEFAULT")
            ? "DEFAULT_CHILD"
            : text.includes("ROOT_FOLLOWUP")
              ? "NESTED_FOLLOWUP"
              : "NESTED_CHILD",
          subagent_type: "helper",
          ...(text.includes("ROOT_FOLLOWUP") ? { task_id: owned.child } : {}),
        },
      }
    if (text.includes("ROOT_INVALID")) {
      const results = input.filter((part) => part.type === "function_call_output" || part.role === "tool")
      assert.match(JSON.stringify(results), /Task configuration is invalid/)
    }
    return { content: "ROOT_RESULT" }
  },
})
const create = async () =>
  (
    await fixture.api("/api/session", {
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
const list = (id) => fixture.api(`/api/session/${id}/task`)
const messages = async (id) => {
  const url = new URL(`/api/session/${id}/message`, fixture.url)
  url.searchParams.set("order", "asc")
  url.searchParams.set("directory", fixture.directory)
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) })
  assert.equal(response.status, 200)
  return response.json()
}

const run = async (id, text) => {
  const before = new Set((await messages(id)).data.map((message) => message.id))
  await fixture.api(`/api/session/${id}/prompt`, { prompt: { text } })
  await poll(
    async () =>
      (await messages(id)).data.some(
        (message) =>
          !before.has(message.id) &&
          message.type === "assistant" &&
          message.time.completed &&
          message.content.some((part) => part.type === "text" && part.text === "ROOT_RESULT"),
      ),
    "root terminal reply",
  )
  await fixture.api(`/api/session/${id}/wait`, undefined, "POST")
}
try {
  const previous = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  const config = {
    snapshots: false,
    task: { maxDepth: 2 },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    agents: { helper: { mode: "subagent", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
    providers: {
      xai: {
        api: {
          type: "aisdk",
          package: "@ai-sdk/xai",
          url: previous.provider.xai.options.baseURL,
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
  }
  await writeFile(join(fixture.directory, "apexo.json"), JSON.stringify(config))
  const root = await create()
  await run(root.id, "ROOT_NESTED")
  const children = await list(root.id)
  assert.equal(children.length, 1)
  owned.child = children[0].id
  const grandchildren = await list(owned.child)
  assert.equal(grandchildren.length, 1)
  assert.equal((await fixture.api(`/api/session/${owned.child}/task/${grandchildren[0].id}`)).output, "LEAF_RESULT")
  assert.equal(calls.length, 5)
  checks.push("configured-depth-two-real-three-session-chain")

  assert.equal((await fetch(`${fixture.url}/api/session/${root.id}/task/${grandchildren[0].id}`)).status, 404)
  const before = await messages(grandchildren[0].id)
  assert.equal(
    (
      await fetch(`${fixture.url}/api/session/${grandchildren[0].id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: { text: "UNAUTHORIZED" } }),
      })
    ).status,
    409,
  )
  assert.deepEqual(await messages(grandchildren[0].id), before)
  assert.equal(calls.length, 5)
  checks.push("direct-parent-management-and-public-prompt-denial")

  await writeFile(join(fixture.directory, "apexo.json"), JSON.stringify({ ...config, task: { maxDepth: 1 } }))
  await fixture.crash()
  await fixture.reopen()
  await run(root.id, "ROOT_FOLLOWUP")
  assert.equal((await list(root.id)).length, 1)
  assert.equal((await list(owned.child)).length, 2)
  assert.equal(calls.length, 10)
  checks.push("restarted-follow-up-retains-original-private-depth-limit")

  const fresh = await create()
  await run(fresh.id, "ROOT_DEFAULT")
  assert.equal((await list(fresh.id)).length, 1)
  assert.deepEqual(await list((await list(fresh.id))[0].id), [])
  assert.equal(calls.length, 13)
  checks.push("new-tree-obeys-current-depth-one")

  await mkdir(join(fixture.directory, ".apexo"), { recursive: true })
  await writeFile(join(fixture.directory, ".apexo", "apexo.json"), JSON.stringify({ task: { maxDepth: 99 } }))
  await fixture.crash()
  await fixture.reopen()
  const invalid = await create()
  await run(invalid.id, "ROOT_INVALID")
  assert.deepEqual(await list(invalid.id), [])
  assert.equal(calls.length, 15)
  checks.push("invalid-higher-priority-policy-zero-child-provider")
  await run(root.id, "ROOT_FOLLOWUP")
  assert.equal((await list(root.id)).length, 1)
  assert.equal((await list(owned.child)).length, 3)
  assert.equal(calls.length, 20)
  checks.push("existing-private-tree-survives-invalid-new-tree-depth-config")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  await fixture.close()
  await writeFile(join(fixture.output, "native-task-nested.json"), JSON.stringify({ checks, calls }, null, 2))
}
