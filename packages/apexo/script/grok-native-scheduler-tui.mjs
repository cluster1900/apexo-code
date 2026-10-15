import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { startSchedulerUiFixture } from "./grok-scheduler-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--narrow") ? 80 : 120
const rows = process.argv.includes("--narrow") ? 24 : 40
const permissionMode = process.argv.includes("--permission")
const fixture = await startSchedulerUiFixture({ permission: permissionMode })
const { runtime, session } = fixture
const screen = new Terminal({ cols, rows, allowProposedApi: true })
const output = { text: "" },
  checks = []
const plain = () =>
  Array.from({ length: rows }, (_, row) =>
    screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const capture = (name) => writeFile(join(runtime.output, `scheduler-tui-${name}.txt`), plain())
const enabled = (title, shortcut) => {
  for (let row = 0; row < rows; row++) {
    const line = screen.buffer.active.getLine(screen.buffer.active.viewportY + row)
    const text = line?.translateToString(true) ?? ""
    const a = text.indexOf(title),
      b = text.indexOf(shortcut, a)
    if (a < 0 || b < 0) continue
    const first = line.getCell(a),
      second = line.getCell(b)
    return first.getFgColorMode() !== second.getFgColorMode() || first.getFgColor() !== second.getFgColor()
  }
  return false
}
let child
try {
  const before = fixture.calls.length
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(fixture.repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--session-protocol",
      "native",
      "--dir",
      runtime.directory,
      "--session",
      session.id,
    ],
    {
      cwd: join(fixture.repo, "packages/apexo"),
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          output.text += text
          screen.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes("ctrl+p"), "native terminal ready", 30000)
  child.terminal.write("/tasks")
  await poll(() => /Manage (session )?tasks/u.test(plain()), "task command selected")
  child.terminal.write("\r")
  if (fullscreen) {
    await poll(
      () => plain().includes("Search session tasks") || !/\/tasks.*Manage/u.test(plain()),
      "command selection completed",
    )
    if (!plain().includes("Search session tasks")) child.terminal.write("\r")
  }
  await poll(
    () => plain().replace(/\s+/gu, " ").includes("Schedules are not running Tasks"),
    "native schedule manager visible",
  )
  assert.ok(/1 running/u.test(plain()), plain())
  const select = async (id) => {
    for (let step = 0; step < 5; step++) {
      if (plain().includes(id)) return
      const previous = plain()
      child.terminal.write("\x1b[B")
      await poll(() => plain() !== previous, "selection changed")
    }
    assert.ok(plain().includes(id), `Selected ${id}: ${plain()}`)
  }
  if (permissionMode) {
    assert.equal((await fixture.list()).find((item) => item.id === fixture.restart.id)?.status, "paused")
    assert.equal((await fixture.permissions()).length, 0)
    assert.ok(
      output.text.includes("Some schedules need permission"),
      "Explicit attach displays restoration outcome without asking",
    )
    await select(fixture.restart.id)
    await poll(
      () => (fullscreen ? enabled("Pause/Resume schedule", "ctrl+r") : !plain().includes("Updating schedule")),
      "Resume enabled",
    )
    child.terminal.write(fullscreen ? "\x12" : "r")
    await poll(async () => (await fixture.permissions()).length === 1, "terminal Resume asks")
    await capture("permission-pending")
    if (fullscreen) {
      child.terminal.write("\x1b")
      await poll(() => !plain().includes("Search session tasks"), "Task dialog closed before permission input")
    }
    await poll(() => /allow once/iu.test(plain()), "permission consent visible")
    await capture("permission-consent")
    child.terminal.write("\r")
    await poll(
      async () => (await fixture.list()).find((item) => item.id === fixture.restart.id)?.status === "active",
      "consented terminal Resume becomes active",
    )
    assert.equal(fixture.calls.length, before)
    await capture("permission-approved")
    checks.push("explicit terminal permission consent resumes future-only intent without provider work")
  } else {
    await select(fixture.active.id)
    await poll(() => plain().includes("Schedule: active"), "active schedule metadata")
    await capture("active")
    const ready = async () =>
      poll(
        () => (fullscreen ? enabled("Pause/Resume schedule", "ctrl+r") : !plain().includes("Updating schedule")),
        "schedule action enabled",
      )
    await ready()
    child.terminal.write(fullscreen ? "\x12" : "p")
    await poll(
      async () => (await fixture.list()).find((item) => item.id === fixture.active.id)?.status === "paused",
      "pause persisted",
    )
    await poll(() => plain().includes("Schedule: paused"), "pause rendered")
    await ready()
    child.terminal.write(fullscreen ? "\x12" : "r")
    await poll(
      async () => (await fixture.list()).find((item) => item.id === fixture.active.id)?.status === "active",
      "future resume persisted",
    )
    await poll(() => plain().includes("Schedule: active"), "resume rendered")
    assert.equal(fixture.calls.length, before)
    checks.push("actual schedule rows and future-only pause/resume without provider work")
    await ready()
    child.terminal.write(fullscreen ? "\x04" : "d")
    await poll(
      async () => !(await fixture.list()).some((item) => item.id === fixture.active.id),
      "future intent deleted",
    )
    assert.equal((await fixture.tasks()).find((item) => item.id === fixture.child.id)?.status, "running")
    assert.equal(fixture.calls.length, before)
    await capture("deleted-child-running")
    checks.push("deleting future intent preserves the independently running Task")
    await select(fixture.restart.id)
    const reveal = async (text) => {
      for (let step = 0; step < 12; step++) {
        if (plain().includes(text)) return
        const previous = plain()
        child.terminal.write("\x1b[6~")
        await poll(() => plain() !== previous || plain().includes(text), "schedule detail scroll")
      }
      assert.ok(plain().includes(text), `Schedule detail visible: ${text}`)
    }
    await reveal("Schedule: active")
    await capture("restored")
    assert.ok(plain().includes("Tasks"), "Manager chrome remains visible with long details")
    assert.equal((await fixture.list()).find((item) => item.id === fixture.restart.id)?.status, "active")
    const restored = (await fixture.records()).filter(
      (item) => item.path.endsWith("/restore") && item.method === "POST",
    )
    assert.equal(restored.length, 1)
    assert.equal(restored[0].status, 200)
    assert.ok(restored[0].contentLength === null || restored[0].contentLength === "0")
    checks.push("explicit terminal attachment restores future cadence once without provider work")
    assert.equal(fixture.calls.length, before)
    const records = await fixture.records()
    assert.ok(
      records
        .filter((item) => /\/schedule\//u.test(item.path) && item.method !== "GET")
        .every((item) => item.contentLength === null || item.contentLength === "0"),
    )
    assert.ok(!records.some((item) => item.path.startsWith("/experimental/")))
    checks.push("native bodyless actions preserve selected protocol and Task authority")
    child.terminal.write("\x1b")
    await poll(
      () => !plain().replace(/\s+/gu, " ").includes("Schedules are not running Tasks"),
      "manager closed before ordinary loop prompt",
    )
    child.terminal.write("/loop 1h SCHED_UI_LOOP_PROMPT $ARGUMENTS")
    await poll(() => plain().includes("SCHED_UI_LOOP_PROMPT"), "loop input rendered")
    child.terminal.write("\r")
    await poll(
      async () => (await fixture.list()).some((item) => item.promptPreview === "SCHED_UI_LOOP_CHILD"),
      "ordinary terminal loop model call creates schedule",
    )
    await deadline(
      runtime.api(`/api/session/${fixture.session.id}/wait`, undefined, "POST"),
      20_000,
      "loop parent drain settled",
    )
    const loopCalls = fixture.calls.slice(before)
    assert.equal(loopCalls.length, 2)
    assert.ok(loopCalls[0].text.includes("scheduler_create") && loopCalls[0].text.includes("$ARGUMENTS"))
    await capture("loop")
    checks.push("loop command uses native discovery and ordinary permission-controlled admission")
  }
  console.log(
    JSON.stringify(
      {
        fullscreen,
        cols,
        rows,
        checks,
        setupProviderCalls: before,
        passiveProviderCalls: 0,
        loopProviderCalls: fixture.calls.length - before,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await capture("final")
  await writeFile(join(runtime.output, "scheduler-tui.ansi"), output.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "Scheduler terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  screen.dispose()
  await fixture.close()
  console.error(`Scheduler terminal evidence: ${runtime.output}`)
}
