import assert from "node:assert/strict"
import { resolve, join } from "node:path"
import { writeFile } from "node:fs/promises"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const { runtime, control } = await startGoalFixture(kind)
const checks = []
const history = []
const command = async (...args) => {
  const child = Bun.spawn(
    [process.execPath, resolve("src/index.ts"), "goal", ...args, "--attach", runtime.url, "--dir", runtime.directory],
    { env: runtime.env, stdout: "pipe", stderr: "pipe" },
  )
  try {
    const [code, stdout, stderr] = await deadline(
      Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
      30000,
      "Goal CLI command",
    )
    history.push({ args, code, stdout, stderr })
    return { code, stdout, stderr, value: code === 0 ? JSON.parse(stdout) : undefined }
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
  }
}
try {
  assert.notEqual((await command("create", "Invalid budget", "--model", "xai/grok-4.7", "--budget", "0")).code, 0)
  assert.equal(control.calls.length, 0)
  control.hold = Promise.withResolvers()
  const created = await command(
    "create",
    "HEADLESS_GOAL complete all requirements",
    "--model",
    "xai/grok-4.7",
    "--budget",
    "10000",
  )
  assert.equal(created.code, 0, created.stderr)
  const sessionID = created.value.sessionID
  const root = `/session/${sessionID}/goal`
  await poll(async () => (await runtime.api(root)).phase === "executing", "headless worker running")
  assert.equal((await command("status", "--session", sessionID)).value.id, created.value.id)
  checks.push("headless-create-empty-session-budget-validation-and-status")
  assert.notEqual((await command("pause", "--session", sessionID, "--id", "goal_stale")).code, 0)
  assert.equal((await runtime.api(root)).status, "active")
  assert.equal((await command("pause", "--session", sessionID)).value.status, "user_paused")
  const retry = await command("start", "--session", sessionID)
  assert.equal(retry.value.status, "user_paused")
  control.hold.resolve()
  control.hold = undefined
  assert.equal((await command("resume", "--session", sessionID)).code, 0)
  await poll(async () => (await runtime.api(root)).status === "complete", "headless goal completed")
  assert.equal(
    (await runtime.api(`/session/${sessionID}/message`)).filter((message) => message.info.role === "user").length,
    1,
  )
  checks.push("stale-id-guard-pause-explicit-resume-and-no-duplicate-objective")
  assert.equal((await command("clear", "--session", sessionID, "--id", created.value.id)).value, true)
  assert.equal((await command("status", "--session", sessionID)).value, null)
  checks.push("headless-clear-and-passive-empty-status")
  console.log(JSON.stringify({ kind, checks, output: runtime.output }, null, 2))
} finally {
  control.hold?.resolve()
  await writeFile(
    join(runtime.output, "goal-cli.json"),
    JSON.stringify({ checks, history, calls: control.calls }, null, 2),
  )
  await runtime.close()
  console.error(`Goal CLI evidence: ${runtime.output}`)
}
