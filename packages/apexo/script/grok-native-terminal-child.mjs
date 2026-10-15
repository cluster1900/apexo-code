import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join } from "node:path"
import { startTaskUiFixture } from "./grok-task-ui-fixture.mjs"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"
const fixture = process.argv.includes("--mixed")
  ? await (async () => {
      const owned = await startPlanUiFixture({
        mixed: true,
        runtime: process.argv.includes("--desktop") ? "desktop" : "cli",
        config: { agent: { helper: { mode: "subagent", permission: { "*": "allow" } } } },
        next: ({ text, finished }) =>
          text.includes("CHILD_DONE")
            ? { content: "TASK_OUTPUT_END" }
            : !finished
              ? {
                  tool: "task",
                  args: { description: "Completed child", prompt: "CHILD_DONE", subagent_type: "helper" },
                }
              : { content: "PARENT_DONE" },
      })
      try {
        const session = (
          await owned.api("/api/session", {
            location: { directory: owned.runtime.directory },
            agent: "build",
            model: { providerID: "xai", id: "grok-4.7" },
          })
        ).data
        await owned.api(`/api/session/${session.id}/prompt`, { prompt: { text: "Create a completed native Task" } })
        const tasks = await poll(
          async () => {
            const rows = await owned.api(`/api/session/${session.id}/task`)
            return rows.some((task) => task.status === "completed") ? rows : undefined
          },
          "real mixed native Task completion",
          30000,
        )
        await poll(
          async () => !(await owned.api("/api/session/active")).data[session.id],
          "parent idle before child view",
        )
        return {
          ...owned,
          session,
          tasks,
          calls: owned.runtime.calls,
          records: async () =>
            (await Bun.file(owned.records).text())
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
        }
      } catch (error) {
        await owned.close()
        throw error
      }
    })()
  : await startTaskUiFixture()
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const manager = process.argv.includes("--manager")
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join("\n")
let child
try {
  const task = fixture.tasks.find((task) => task.status === "completed")
  assert.ok(task)
  const session = (await runtime.api(`/api/session/${task.id}`)).data
  assert.equal(session.parentID, fixture.session.id)
  const before = fixture.calls.length
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini"] : []),
      ...(process.argv.includes("--mixed") ? ["--session-protocol", "native"] : []),
      "--dir",
      runtime.directory,
      "--session",
      manager ? fixture.session.id : task.id,
    ],
    {
      cwd: join(repo, "packages/apexo"),
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          output.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  if (manager) {
    await poll(
      () => plain().includes("PARENT_DONE") && plain().includes("/tasks"),
      "parent native Task transcript and manager count",
      30000,
    )
    if (!fullscreen)
      await poll(
        async () =>
          (await fixture.records()).filter((record) => record.method === "GET" && record.path.endsWith("/question"))
            .length >= 2,
        "native mini manager bootstrap",
        30000,
      )
    child.terminal.write("/tasks\r")
    if (fullscreen) {
      await poll(() => plain().includes("Manage tasks"), "fullscreen command selection", 10000)
      child.terminal.write("\r")
    }
    await poll(
      () => plain().includes("recent tasks") && (plain().includes("c stop") || plain().includes("Stop task")),
      "existing native Tasks manager",
      30000,
    )
  } else {
    await poll(() => plain().includes("TASK_OUTPUT_END"), "actual managed child transcript", 30000)
  }
  assert.equal(fixture.calls.length, before)
  if (process.argv.includes("--mixed")) {
    const requests = await fixture.records()
    assert.equal(
      requests.some((request) => !request.path.startsWith("/api/")),
      false,
    )
  }
  console.log(
    JSON.stringify(
      {
        checks: manager
          ? ["existing Tasks manager opens from native terminal", "passive manager makes no provider calls"]
          : [
              "managed child is viewable through native canonical history",
              "read-only attach does not resume child or call provider",
            ],
        mode: fullscreen ? "fullscreen" : "mini",
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await Bun.write(join(runtime.output, "child-terminal.txt"), plain())
  await Bun.write(join(runtime.output, "child-terminal.ansi"), output.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "child terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  await fixture.close()
  console.error(`Child terminal evidence: ${runtime.output}`)
}
