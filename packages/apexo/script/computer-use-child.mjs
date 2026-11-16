import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { startComputerUseFixture } from "./computer-use-fixture.mjs"

const fixture = await startComputerUseFixture("cli", {
  config: {
    agents: {
      parent: { mode: "primary", permissions: [{ action: "task", resource: "desktop-child", effect: "allow" }] },
      "desktop-child": {
        mode: "subagent",
        permissions: [{ action: toolName("desktop_permissions"), resource: "*", effect: "allow" }],
      },
    },
  },
})
const checks = []
try {
  await fixture.install()
  const control = await fixture.client.sessions.create({
    location: fixture.location,
    agent: "desktop-child",
    model: { providerID: "computer-fixture", id: "model" },
  })
  fixture.state.steps.push({ tool: toolName("desktop_permissions"), args: {} })
  await fixture.prompt(control.id, "Check this agent's own configured desktop authority.")
  const controlMessages = (await fixture.client.messages.list({ sessionID: control.id, order: "asc" })).data
  assert.ok(
    controlMessages.some(
      (message) =>
        message.type === "assistant" &&
        message.content.some(
          (part) =>
            part.type === "tool" && part.name === toolName("desktop_permissions") && part.state.status === "completed",
        ),
    ),
  )
  const parent = await fixture.client.sessions.create({
    location: fixture.location,
    agent: "parent",
    model: { providerID: "computer-fixture", id: "model" },
  })
  fixture.state.steps.push(
    {
      tool: "task",
      args: {
        description: "Restricted desktop child",
        prompt: "Check desktop permissions without raising inherited authority.",
        subagent_type: "desktop-child",
      },
    },
    { tool: toolName("desktop_permissions"), args: {} },
  )
  await fixture.prompt(parent.id, "Run the restricted desktop child.")
  const tasks = await fixture.client["server.task"].list({ sessionID: parent.id })
  assert.equal(tasks.length, 1)
  const child = (await fixture.client.messages.list({ sessionID: tasks[0].id, order: "asc" })).data
  const calls = child.flatMap((message) =>
    message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, toolName("desktop_permissions"))
  assert.equal(calls[0].state.status, "error")
  checks.push("real-child-cannot-raise-parent-desktop-denial")
  console.log(JSON.stringify({ passed: checks.length, checks, output: fixture.runtime.output }))
} finally {
  await writeFile(join(fixture.runtime.output, "computer-use-child.json"), JSON.stringify({ checks }, null, 2))
  await fixture.runtime.close()
}
