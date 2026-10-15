// Real installed Grok ACP promotion; keep only relevant events, never setup/config notifications.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline, poll } from "./grok-shell-fixture.mjs"
const directory = await mkdtemp(join(tmpdir(), "apexo-shell-official-"))
const child = spawn("bun", ["run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", directory], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  stdio: ["pipe", "pipe", "pipe"],
})
const exited = new Promise((resolve) => child.once("exit", resolve))
const updates = []
const stderr = []
child.stderr.on("data", (data) => stderr.push(data))
const state = { sessionID: "", toolID: "" }
const manageTasks = process.argv.includes("--tasks")
function record(update) {
  if (
    ![
      "agent_message_chunk",
      "tool_call",
      "tool_call_update",
      "task_completed",
      "task_backgrounded",
      "turn_completed",
    ].includes(update.sessionUpdate)
  )
    return
  if (update.sessionUpdate === "tool_call") state.toolID = update.toolCallId
  updates.push({
    sessionUpdate: update.sessionUpdate,
    toolCallId: update.toolCallId,
    status: update.status,
    title: update.title,
    text: update.content?.type === "text" ? update.content.text : undefined,
    content: Array.isArray(update.content)
      ? update.content
          .filter((item) => item.type === "content" && item.content?.type === "text")
          .map((item) => item.content.text)
      : undefined,
    prompt_id: update.prompt_id,
    time: Date.now(),
  })
}
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      const option = params.options.find((option) => option.kind === "allow_once")
      assert.ok(option)
      return { outcome: { outcome: "selected", optionId: option.optionId } }
    },
    async sessionUpdate(params) {
      record(params.update)
    },
    async extNotification(method, params) {
      if (method === "_x.ai/session_notification" && params.update) record(params.update)
      if (method === "_x.ai/task_completed") record({ sessionUpdate: "task_completed" })
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
try {
  await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  const session = await connection.newSession({ cwd: directory, mcpServers: [] })
  state.sessionID = session.sessionId
  const turn = connection.prompt({
    sessionId: state.sessionID,
    prompt: [
      {
        type: "text",
        text: "Run exactly one FOREGROUND terminal command with a 60000ms foreground wait if supported: printf 'OFFICIAL_FOREGROUND_STARTED 😀'; printf 'SHELL_STDERR_中文' >&2; echo $$ > shell.pid; while [ ! -f shell.release ]; do sleep 0.1; done; printf OFFICIAL_FOREGROUND_FINISHED. Do not request background execution yourself. The test client will move this same running command to the background. When the tool returns while it still runs, end the turn with exactly OFFICIAL_PROMOTED. Do not poll, wait, read output, start subagents or run any other command. When the automatic completion notification arrives, reply exactly OFFICIAL_PROMOTION_OBSERVED.",
      },
    ],
  })
  turn.catch(() => {})
  const pid = await poll(
    async () => Number(await readFile(join(directory, "shell.pid"), "utf8").catch(() => "")),
    "official foreground started",
    60000,
  )
  assert.ok(state.toolID, "Missing official tool ID")
  process.kill(pid, 0)
  const before = Date.now()
  await connection.extMethod("_x.ai/terminal/background", { sessionId: state.sessionID, terminalId: state.toolID })
  const result = await deadline(turn, 30000, "official backgrounded turn")
  assert.equal(result.stopReason, "end_turn")
  process.kill(pid, 0)
  assert.equal(Number(await readFile(join(directory, "shell.pid"), "utf8")), pid)
  assert.ok(
    updates
      .map((u) => u.text ?? "")
      .join("")
      .includes("OFFICIAL_PROMOTED"),
  )
  if (manageTasks) {
    const listed = await connection.extMethod("_x.ai/task/list", { sessionId: state.sessionID })
    assert.equal(listed.error, undefined)
    assert.ok(listed.result?.tasks?.length, "Official task list contains background command")
    await writeFile(join(directory, "task-list.json"), JSON.stringify(listed.result, null, 2))
    const other = await connection.newSession({ cwd: directory, mcpServers: [] })
    const isolated = await connection.extMethod("_x.ai/task/list", { sessionId: other.sessionId })
    assert.deepEqual(isolated.result?.tasks, [])
    const killed = await connection.extMethod("_x.ai/task/kill", { sessionId: state.sessionID, taskId: state.toolID })
    assert.equal(killed.error, undefined)
    await poll(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    }, "official cancelled process exit")
    const after = await connection.extMethod("_x.ai/task/list", { sessionId: state.sessionID })
    await writeFile(join(directory, "task-cancel.json"), JSON.stringify({ killed, after }, null, 2))
    console.log(
      JSON.stringify({
        result: "pass",
        scope: "official background task list, session isolation, UI cancellation and process exit",
        directory,
        pid,
      }),
    )
  }
  if (!manageTasks) {
    await writeFile(join(directory, "shell.release"), "release")
    await poll(
      () =>
        updates
          .map((u) => u.text ?? "")
          .join("")
          .includes("OFFICIAL_PROMOTION_OBSERVED"),
      "official completion wake",
      60000,
    )
    assert.equal(updates.filter((u) => u.sessionUpdate === "tool_call").length, 1)
    assert.equal(updates.filter((u) => u.sessionUpdate === "task_completed").length, 1)
    const output = updates
      .filter((update) => update.sessionUpdate === "tool_call_update")
      .flatMap((update) => update.content ?? [])
      .join("")
    assert.ok(
      output.includes("😀") && output.includes("SHELL_STDERR_中文"),
      "Official tool output preserves both streams",
    )
    assert.ok(!output.includes("�"))
    console.log(
      JSON.stringify({
        result: "pass",
        directory,
        pid,
        toolID: state.toolID,
        elapsed: Date.now() - before,
        toolCalls: 1,
        completions: 1,
      }),
    )
  }
} finally {
  await writeFile(join(directory, "shell.release"), "cleanup")
  if (state.sessionID) await connection.cancel({ sessionId: state.sessionID }).catch(() => {})
  child.kill("SIGTERM")
  await deadline(exited, 10000, "official cleanup").catch(() => child.kill("SIGKILL"))
  await writeFile(join(directory, "updates.json"), JSON.stringify(updates, null, 2))
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  console.error(`Official Shell evidence: ${directory}`)
}
