// bun script/grok-background-official.mjs
// Uses the installed official Grok through Apexo's ACP proxy and its real provider.
import { spawn } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import assert from "node:assert/strict"

const directory = await mkdtemp(join(tmpdir(), "apexo-background-official-"))
const monitor = process.argv[2]?.startsWith("monitor") === true
const scheduler = process.argv[2] === "scheduler"
const eventStream = process.argv[2] === "monitor-stderr" ? "stderr" : "stdout"
const marker = scheduler
  ? "OFFICIAL_SCHEDULER_OBSERVED"
  : monitor
    ? "OFFICIAL_MONITOR_OBSERVED"
    : "OFFICIAL_BACKGROUND_OBSERVED"
const child = spawn("bun", ["run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", directory], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  env: { ...process.env, APEXO_GROK_BUILD_BIN: "grok" },
  stdio: ["pipe", "pipe", "pipe"],
})
const exited = new Promise((resolve) => child.once("exit", resolve))
const updates = []
const stderr = []
const schedule = { sessionID: "", taskID: "", deleted: false }
child.stderr.on("data", (chunk) => stderr.push(chunk))
const complete = Promise.withResolvers()
const timer = setTimeout(() => complete.reject(new Error("Official background notification timed out")), 120_000)
function record(update) {
  if (scheduler && update.rawOutput?.type === "SchedulerCreate" && update.rawOutput.id)
    schedule.taskID = update.rawOutput.id
  if (scheduler && update.rawOutput?.type === "SchedulerDelete" && update.rawOutput.success) schedule.deleted = true
  // ACP setup notifications may contain unrelated private configuration.
  // Retain only the fields needed to prove this scenario's lifecycle.
  if (!["agent_message_chunk", "tool_call", "task_completed", "turn_completed"].includes(update.sessionUpdate)) return
  updates.push({
    time: Date.now(),
    sessionUpdate: update.sessionUpdate,
    title: update.title,
    text: update.content?.type === "text" ? update.content.text : undefined,
    prompt_id: update.prompt_id,
    stop_reason: update.stop_reason,
  })
  const text = updates
    .filter((update) => update.sessionUpdate === "agent_message_chunk")
    .map((update) => update.text ?? "")
    .join("")
  if (
    text.includes(marker) &&
    (monitor || scheduler
      ? updates.filter((update) => update.sessionUpdate === "turn_completed").length >= 2
      : updates.some(
          (update) => update.sessionUpdate === "turn_completed" && update.prompt_id?.startsWith("task-completed-"),
        ))
  )
    complete.resolve()
}
const connection = new ClientSideConnection(
  () => ({
    async requestPermission(params) {
      const option = params.options.find((option) => option.kind === "allow_once")
      assert.ok(option, "Expected allow-once permission")
      return { outcome: { outcome: "selected", optionId: option.optionId } }
    },
    async extNotification(method, params) {
      if (method === "_x.ai/session_notification" && params.update) record(params.update)
      if (method === "_x.ai/task_completed") record({ sessionUpdate: "task_completed" })
    },
    async sessionUpdate(params) {
      record(params.update)
    },
  }),
  ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
)
try {
  await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  const session = await connection.newSession({ cwd: directory, mcpServers: [] })
  schedule.sessionID = session.sessionId
  const result = await connection.prompt({
    sessionId: session.sessionId,
    prompt: [
      {
        type: "text",
        text: scheduler
          ? "Call scheduler_create exactly once with interval=1m, prompt='Reply with exactly OFFICIAL_SCHEDULED_RESULT without using tools', fire_immediately=false and durable=false. End this turn saying STARTED. Do not wait or poll. After the first automatic scheduled subagent result OFFICIAL_SCHEDULED_RESULT arrives, immediately call scheduler_delete with the created task ID. Only after deletion succeeds reply with exactly OFFICIAL_SCHEDULER_OBSERVED. This test must leave no schedule behind."
          : monitor
            ? `Call the monitor tool exactly once with command: sleep 2; printf 'OFFICIAL_MONITOR_EVENT\\n'${eventStream === "stderr" ? " >&2" : ""}; sleep 30. Use description 'monitor parity' and timeout_ms 60000. End this turn saying STARTED. Do not poll, wait, run other commands or subagents. Only after the automatic event containing OFFICIAL_MONITOR_EVENT arrives, reply with exactly OFFICIAL_MONITOR_OBSERVED. The test client will stop the session afterwards.`
            : "Run exactly one background terminal command: sleep 2; printf OFFICIAL_BACKGROUND_RESULT. Use the background execution option. Do not use a wait, output lookup, extra shell command, or subagent. End this turn saying STARTED. Only after an automatic completion notification reports the command exited successfully, reply with exactly OFFICIAL_BACKGROUND_OBSERVED. The notification need not include stdout; exit code 0 is sufficient. This checks automatic background completion delivery.",
      },
    ],
  })
  assert.equal(result.stopReason, "end_turn")
  await complete.promise
  const toolCalls = updates.filter((update) => update.sessionUpdate === "tool_call")
  assert.equal(toolCalls.length, scheduler ? 2 : 1, "Official agent polled or used extra tools")
  if (scheduler) assert.equal(schedule.deleted, true, "Test schedule was not deleted")
  if (!monitor && !scheduler)
    assert.ok(
      updates.some((update) => update.sessionUpdate === "task_completed"),
      "Missing automatic task completion event",
    )
  console.log(
    JSON.stringify({
      directory,
      monitor,
      scheduler,
      eventStream,
      result: "pass",
      stopReason: result.stopReason,
      toolCalls: toolCalls.length,
    }),
  )
} finally {
  clearTimeout(timer)
  if (scheduler && schedule.taskID && !schedule.deleted) {
    await connection.cancel({ sessionId: schedule.sessionID }).catch(() => {})
    await connection
      .prompt({
        sessionId: schedule.sessionID,
        prompt: [
          {
            type: "text",
            text: `Cleanup this test now: call scheduler_delete with task_id=${schedule.taskID}, then stop. Do not create or run anything else.`,
          },
        ],
      })
      .catch((error) => console.error("Scheduler cleanup failed:", error.message))
  }
  await writeFile(join(directory, "updates.json"), JSON.stringify(updates, null, 2))
  await writeFile(join(directory, "stderr.log"), Buffer.concat(stderr))
  child.kill("SIGTERM")
  await exited
  if (scheduler && schedule.taskID && !schedule.deleted)
    console.error(`UNCONFIRMED CLEANUP: test schedule ${schedule.taskID} in isolated directory ${directory}`)
  console.error(`Official evidence: ${directory}`)
}
