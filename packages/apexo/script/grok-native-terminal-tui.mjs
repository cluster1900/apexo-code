import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join } from "node:path"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const scenario = process.argv.includes("--plan")
  ? "plan"
  : process.argv.includes("--permission")
    ? "permission"
    : process.argv.includes("--stop")
      ? "stop"
      : "ordinary"
const fixture = await startPlanUiFixture({
  mixed: process.argv.includes("--mixed"),
  runtime: process.argv.includes("--desktop") ? "desktop" : "cli",
  ...(scenario === "permission" ? { config: { permission: { "*": "allow", bash: "ask" } } } : {}),
})
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  const prepared = await fixture.prepare(scenario)
  const before = runtime.calls.length
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini"] : []),
      ...(process.argv.includes("--mixed") || process.argv.includes("--explicit")
        ? ["--session-protocol", "native"]
        : []),
      "--dir",
      runtime.directory,
      "--session",
      prepared.session.id,
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
  if (scenario === "stop") {
    await poll(
      () => plain().includes("Native terminal cancellation") || plain().includes("sleep 30"),
      "active native tool transcript",
      30000,
    )
    const startedCalls = runtime.calls.length
    assert.equal(startedCalls, 1, "exactly one provider turn starts the held command")
    child.terminal.write("\x1b")
    await Bun.sleep(150)
    child.terminal.write("\x1b")
    await poll(
      async () => !(await fixture.api("/api/session/active")).data[prepared.session.id],
      "actual terminal Stop settles native ownership",
      10000,
    )
    assert.equal(runtime.calls.length, startedCalls)
    assert.ok(!plain().includes("NATIVE_STOP_UNEXPECTED_CONTINUATION"))
    checks.push("real terminal Stop interrupts active native command without provider continuation")
  } else {
    const expected =
      scenario === "permission"
        ? "Permission required"
        : scenario === "plan"
          ? "PLAN_UI_EXACT_ARTIFACT"
          : "An ordinary question allows a custom answer"
    await poll(() => plain().includes(expected), `real native terminal pending ${scenario}`, 30000)
    assert.equal(runtime.calls.length, before)
    if (scenario === "permission") {
      assert.ok(plain().includes("printf NATIVE_PERMISSION_EXECUTED"))
      assert.equal(
        (await fixture.api(`/api/session/${prepared.session.id}/permission`)).data[0].id,
        prepared.question.id,
      )
    }
    checks.push(`native attach restores pending ${scenario} without provider work`)
    child.terminal.write("\r")
    const finished =
      scenario === "permission"
        ? "NATIVE_PERMISSION_DONE"
        : scenario === "plan"
          ? "PLAN_UI_CONTINUED"
          : "ORDINARY_QUESTION_DONE"
    await poll(() => plain().includes(finished), `real native terminal ${scenario} continuation`, 30000)
    checks.push("actual terminal approval resumes original native turn and renders canonical SSE")
    if (scenario === "plan")
      assert.equal((await fixture.api(`/api/session/${prepared.session.id}`)).data.agent, "build")
    if (process.argv.includes("--reconnect")) {
      const calls = runtime.calls.length
      fixture.disconnectEvents?.()
      await poll(
        async () =>
          (await Bun.file(fixture.records).text())
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .filter((request) => request.method === "GET" && request.path === "/api/event").length >= 3,
        "actual terminal SSE reconnect",
        25000,
      )
      assert.equal(runtime.calls.length, calls)
      assert.ok(plain().includes(finished))
      checks.push("SSE reconnect restores durable state without repeating provider work")
    }
    child.terminal.write("NATIVE_TERMINAL_SECOND_PROMPT\r")
    await poll(() => runtime.calls.length === before + 2, "real native terminal second prompt", 30000)
    await poll(() => plain().includes("NATIVE_TERMINAL_SECOND_PROMPT"), "native terminal input rendered", 10000)
    checks.push("existing Session accepts a second durable prompt through native API")
  }
  if (process.argv.includes("--panels")) {
    await poll(
      async () => !(await fixture.api("/api/session/active")).data[prepared.session.id],
      "native turn idle before panels",
    )
    const calls = runtime.calls.length
    child.terminal.write("\x1b[200~/goal status \x1b[201~")
    await poll(() => plain().includes("/goal status"), "Goal command entered")
    child.terminal.write("\r")
    await poll(() => plain().includes("Objective · Tab switches fields"), "native Goal panel on mixed server", 30000)
    child.terminal.write("\x1b[27u")
    await poll(() => !plain().includes("Closing this panel does not pause"), "Goal panel closed")
    child.terminal.write("/tasks\r")
    if (fullscreen) {
      await poll(() => plain().includes("Manage tasks"), "fullscreen task command selection")
      child.terminal.write("\r")
    }
    await poll(() => plain().includes("No tasks in this session"), "native Tasks panel on mixed server", 30000)
    assert.equal(runtime.calls.length, calls)
    checks.push("Goal and Tasks panels share native selection without provider work")
  }
  if (process.argv.includes("--mixed")) {
    const requests = (await Bun.file(fixture.records).text())
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    assert.ok(
      requests.some((request) => request.path.endsWith("/history")),
      "real canonical history read",
    )
    assert.equal(
      requests.some((request) => !request.path.startsWith("/api/")),
      false,
      "explicit native never probes or falls back to compatibility",
    )
    if (process.argv.includes("--panels")) {
      assert.ok(requests.some((request) => request.path === `/api/session/${prepared.session.id}/goal`))
      assert.ok(requests.some((request) => request.path === `/api/session/${prepared.session.id}/task`))
    }
    checks.push("recorded requests stay on native endpoints on a mixed server")
  }
  console.log(
    JSON.stringify(
      {
        checks,
        scenario,
        server: process.argv.includes("--mixed") ? "mixed" : "native",
        mode: fullscreen ? "fullscreen" : "mini",
        providerCalls: runtime.calls.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await Bun.write(join(runtime.output, "native-terminal.txt"), plain())
  await Bun.write(join(runtime.output, "native-terminal.ansi"), output.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "owned terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  terminal.dispose()
  await fixture.close()
  console.error(`Native terminal evidence: ${runtime.output}`)
}
