// bun script/grok-scheduler-restart-official.mjs
// Real official ACP process restart with explicit normal/error-path task deletion.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"

const directory = await mkdtemp(join(tmpdir(), "apexo-scheduler-restart-official-"))
const updates = []
const processes = []
const state = { sessionID: "", taskID: "", deleted: false, epoch: 0, fired: false }

async function start() {
  const child = spawn("bun", ["run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", directory], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    env: { ...process.env, APEXO_GROK_BUILD_BIN: "grok" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const epoch = ++state.epoch
  const stderr = []
  const replies = []
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  const exited = new Promise((resolve) => child.once("exit", resolve))
  function record(update, live = true) {
    if (update.rawOutput?.type === "SchedulerCreate" && update.rawOutput.id) state.taskID = update.rawOutput.id
    if (update.rawOutput?.type === "SchedulerDelete" && update.rawOutput.success) state.deleted = true
    if (live && update.rawOutput?.type === "SchedulerList" && state.taskID)
      state.deleted = !update.rawOutput.tasks.some((task) => task.id === state.taskID)
    if (!["tool_call", "tool_call_update", "agent_message_chunk"].includes(update.sessionUpdate)) return
    const text = update.content?.type === "text" ? update.content.text : undefined
    updates.push({
      epoch,
      live,
      type: update.sessionUpdate,
      title: update.title,
      status: update.status,
      text,
      input: update.rawInput,
      output: update.rawOutput,
    })
    if (epoch > 1 && live && text) {
      replies.push(text)
      if (replies.join("").includes("OFFICIAL_RESTART_FIRE_OBSERVED")) state.fired = true
    }
  }
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params) {
        const option = params.options.find((option) => option.kind === "allow_once")
        assert.ok(option)
        return { outcome: { outcome: "selected", optionId: option.optionId } }
      },
      async extNotification(method, params) {
        if (method === "_x.ai/session_notification" && params.update) record(params.update)
      },
      async sessionUpdate(params) {
        record(params.update, !loading)
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  )
  let loading = false
  const runtime = {
    child,
    connection,
    stop: async () => {
      child.kill("SIGTERM")
      await deadline(exited, 10_000, "official process exit")
      await writeFile(join(directory, `process-${epoch}.stderr`), Buffer.concat(stderr))
    },
    prompt: (text) =>
      deadline(
        connection.prompt({ sessionId: state.sessionID, prompt: [{ type: "text", text }] }),
        45_000,
        "official prompt",
      ),
  }
  processes.push(runtime)
  const initialized = await deadline(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
    20_000,
    "official initialize",
  )
  assert.ok(initialized.agentCapabilities?.loadSession, "Official binary does not support ACP session resume")
  if (!state.sessionID) {
    const session = await connection.newSession({ cwd: directory, mcpServers: [] })
    state.sessionID = session.sessionId
    return runtime
  }
  loading = true
  await deadline(
    connection.loadSession({ sessionId: state.sessionID, cwd: directory, mcpServers: [] }),
    20_000,
    "official loadSession",
  )
  loading = false
  return runtime
}

let current
try {
  current = await start()
  await current.prompt(
    "This is a scheduler restart test. Call scheduler_create exactly once with interval=1m, durable=true, fire_immediately=false, and prompt='Reply OFFICIAL_RESTART_CHILD_OK without any tools'. Then scheduler_list and reply CREATED. Do not delete yet: the test driver will restart the client immediately and resume this session. When the scheduled result arrives later, reply OFFICIAL_RESTART_FIRE_OBSERVED. Do not create any other tasks or use other tools.",
  )
  assert.ok(state.taskID, "No test schedule created")
  const original = updates.findLast((item) => item.output?.type === "SchedulerList")?.output.tasks
  assert.equal(original?.length, 1)
  await current.stop()
  current = await start()
  const index = updates.length
  await current.prompt(
    "Call scheduler_list once to verify the saved schedule survived the client restart. Do not create or change any tasks. Reply RESUMED. When the scheduled result arrives, reply OFFICIAL_RESTART_FIRE_OBSERVED.",
  )
  const resumed = updates.slice(index).findLast((item) => item.output?.type === "SchedulerList")?.output.tasks
  assert.equal(resumed?.length, 1, "Schedule did not resume")
  assert.equal(resumed[0].id, state.taskID)
  assert.equal(resumed[0].createdAt, original[0].createdAt)
  assert.equal(resumed[0].nextFireAt, original[0].nextFireAt)
  const end = Date.now() + 80_000
  while (!state.fired && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(state.fired, true, "No scheduled result after official restart")
  await current.prompt(
    `Cleanup: call scheduler_delete task_id=${state.taskID}, then scheduler_list. Do not create any tasks. Reply DELETED.`,
  )
  assert.equal(state.deleted, true)
  assert.deepEqual(updates.findLast((item) => item.output?.type === "SchedulerList")?.output.tasks, [])
  await current.stop()
  current = await start()
  const finalIndex = updates.length
  await current.prompt("Call scheduler_list once. It must be empty; do not create any tasks. Reply VERIFIED.")
  assert.deepEqual(
    updates.slice(finalIndex).findLast((item) => item.output?.type === "SchedulerList")?.output.tasks,
    [],
  )
  console.log(
    JSON.stringify({
      result: "pass",
      directory,
      processes: processes.length,
      firedAfterRestart: true,
      deletedAfterRestart: true,
    }),
  )
} finally {
  if (state.taskID && !state.deleted) {
    if (!current || current.child.exitCode !== null || current.child.signalCode !== null) current = await start()
    await current.connection.cancel({ sessionId: state.sessionID }).catch(() => {})
    await current
      .prompt(
        `Cleanup this test schedule now: scheduler_delete task_id=${state.taskID}; then scheduler_list. Do not create any tasks.`,
      )
      .catch((error) => console.error(`Official cleanup failed: ${error.message}`))
    if (!state.deleted) console.error(`Cleanup needs attention: ${state.taskID}`)
  }
  await writeFile(join(directory, "updates.json"), JSON.stringify(updates, null, 2))
  for (const runtime of processes)
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) await runtime.stop()
  console.error(`Official restart evidence: ${directory}`)
}

function deadline(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
