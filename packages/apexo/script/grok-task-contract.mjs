// Real CLI / packaged Electron tool dispatch; the local provider sends exact boundary inputs.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const cases = []
const sent = new Set()
const schemas = new Map()
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  env: { GROK_MAX_WAIT_BLOCK_MS: "80" },
  next({ body, text, ancillary, finished }) {
    if (ancillary) return
    for (const item of body.tools) {
      const definition = item.function ?? item
      if (["get_task_output", "wait_tasks"].includes(definition.name))
        schemas.set(definition.name, definition.parameters)
    }
    const index = Number(text.match(/TASK_CONTRACT_(\d+)/)?.[1])
    if (!Number.isInteger(index) || sent.has(index) || finished) return
    sent.add(index)
    return cases[index]
  },
})
const evidence = []
const sessions = []
async function invoke(session, tool, args) {
  const index = cases.push({ tool, args }) - 1
  const previous = new Set(
    (await runtime.api(`/session/${session}/message`)).flatMap((message) => message.parts.map((part) => part.id)),
  )
  await runtime.api(`/session/${session}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: `TASK_CONTRACT_${index}` }],
  })
  const result = await poll(
    async () =>
      (await runtime.api(`/session/${session}/message`))
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            !previous.has(part.id) && part.type === "tool" && ["completed", "error"].includes(part.state.status),
        ),
    `tool result ${index}`,
  )
  await poll(async () => (await runtime.api("/session/status"))[session]?.type !== "busy", "parent idle")
  evidence.push({ tool, args, state: result.state })
  return result.state
}
try {
  const session = await runtime.api("/session", { title: "Task input contract" })
  const other = await runtime.api("/session", { title: "Task isolation" })
  sessions.push(session.id, other.id)
  const started = await invoke(session.id, "run_terminal_cmd", {
    command: "printf TASK_CONTRACT_OUTPUT; echo $$ > task.pid; while [ ! -f task.release ]; do sleep 0.1; done",
    description: "task contract running command",
    block_until_ms: 0,
  })
  const id = started.metadata.task_id
  const pid = await poll(
    async () => Number(await readFile(join(runtime.directory, "task.pid"), "utf8").catch(() => "")),
    "real shell PID",
  )
  assert.equal(typeof id, "string")
  for (const args of [{ task_ids: ` ${id} ` }, { task_id: ` ${id} ` }, { task_ids: Array(21).fill(` ${id} `) }]) {
    const result = await invoke(session.id, "get_task_output", args)
    assert.equal(result.status, "completed")
    assert.equal(result.metadata.task_id, id)
    assert.equal(result.metadata.status, "running")
    assert.equal(result.output.split("TASK_CONTRACT_OUTPUT").length, 2)
  }
  const numeric = await invoke(session.id, "get_task_output", { task_ids: [228, " 228 ", "", "missing"] })
  assert.deepEqual(numeric.metadata.task_ids, ["228", "missing"])
  assert.ok(numeric.metadata.statuses.every((task) => task.status === "not_found"))
  for (const args of [{}, { task_ids: null }, { task_ids: [" ", ""] }, { task_ids: [id], task_id: id }]) {
    assert.equal((await invoke(session.id, "get_task_output", args)).metadata.status, "invalid_request")
  }
  for (const name of ["get_task_output", "wait_tasks"]) {
    const ids = Array.from({ length: 20 }, (_, index) => `missing-${index}`)
    assert.deepEqual((await invoke(session.id, name, { task_ids: ids, mode: "wait_all" })).metadata.task_ids, ids)
    assert.equal(
      (await invoke(session.id, name, { task_ids: [...ids, "overflow"], mode: "wait_all" })).metadata.status,
      "invalid_request",
    )
    const result = await invoke(session.id, name, { task_ids: [id], mode: "wait_all", timeout_ms: 10_000 })
    const elapsed = result.time.end - result.time.start
    assert.ok(elapsed >= 60 && elapsed < 3000, `Host cap did not bound ${name}: ${elapsed}ms`)
    assert.match(result.output, /status="running"/)
    process.kill(pid, 0)
    const schema = schemas.get(name)
    assert.equal(schema.properties.timeout_ms.maximum, 80)
    assert.equal(schema.properties.task_ids.maxItems, 20)
    assert.equal(schema.properties.task_ids.items.type, "string")
    assert.equal(schema.properties.task_id, undefined)
  }
  assert.equal(
    (await invoke(session.id, "wait_tasks", { task_ids: Array(21).fill(id), mode: "wait_all" })).metadata.status,
    "invalid_request",
  )
  const raw = [" missing ", "missing", "missing", ""]
  assert.deepEqual((await invoke(session.id, "wait_tasks", { task_ids: raw, mode: "wait_all" })).metadata.task_ids, raw)
  const waited = await invoke(session.id, "wait_tasks", {
    task_ids: ["missing", id],
    mode: "wait_any",
    timeout_ms: 10_000,
  })
  assert.deepEqual(waited.metadata.statuses, [
    { task_id: "missing", status: "not_found" },
    { task_id: id, status: "running" },
  ])
  assert.ok(waited.time.end - waited.time.start >= 60, "A missing ID ended wait_any before its pending task")
  assert.equal((await invoke(session.id, "get_task_output", { task_ids: true })).status, "error")
  const isolated = await invoke(other.id, "get_task_output", { task_ids: ` ${id} ` })
  assert.equal(isolated.metadata.status, "not_found")
  assert.ok(!isolated.output.includes("TASK_CONTRACT_OUTPUT"))
  assert.equal((await invoke(session.id, "kill_task", { task_id: id })).metadata.status, "cancelled")
  await poll(() => {
    try {
      process.kill(pid, 0)
      return false
    } catch {
      return true
    }
  }, "cancelled PID exit")
  const detached = []
  for (const owner of [
    { session: session.id, file: "deleted-owner.pid" },
    { session: other.id, file: "other-owner.pid" },
  ]) {
    const job = await invoke(owner.session, "run_terminal_cmd", {
      command: `echo $$ > ${owner.file}; while [ ! -f task.release ]; do sleep 0.1; done`,
      description: "detached Session deletion regression",
      block_until_ms: 0,
    })
    detached.push({
      id: job.metadata.task_id,
      pid: await poll(
        async () => Number(await readFile(join(runtime.directory, owner.file), "utf8").catch(() => "")),
        "detached shell PID",
      ),
    })
  }
  await runtime.api(`/session/${session.id}`, undefined, "DELETE")
  await poll(() => {
    try {
      process.kill(detached[0].pid, 0)
      return false
    } catch (error) {
      if (error.code === "ESRCH") return true
      throw error
    }
  }, "deleted Session's detached process exit")
  process.kill(detached[1].pid, 0)
  assert.equal((await invoke(other.id, "kill_task", { task_id: detached[1].id })).metadata.status, "cancelled")
  evidence.push({ action: "delete-session", ownedProcessStopped: true, unrelatedProcessPreserved: true })
  console.log(
    JSON.stringify({
      result: "pass",
      kind: process.argv[2] ?? "cli",
      cases: evidence.length,
      output: runtime.output,
      hostWaitMs: 80,
    }),
  )
} finally {
  await writeFile(join(runtime.directory, "task.release"), "cleanup")
  await Promise.all(sessions.map((id) => runtime.api(`/session/${id}/abort`, undefined, "POST").catch(() => {})))
  await writeFile(
    join(runtime.output, "task-contract.json"),
    JSON.stringify({ schemas: Object.fromEntries(schemas), evidence }, null, 2),
  )
  await runtime.close()
  console.error(`Task contract evidence: ${runtime.output}`)
}
