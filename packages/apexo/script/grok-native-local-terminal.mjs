import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const fullscreen = process.argv.includes("--fullscreen")
const compatibility = process.argv.includes("--compatibility")
const resume = process.argv.includes("--resume")
const scenario = process.argv.includes("--stop")
  ? "stop"
  : process.argv.includes("--plan")
    ? "plan"
    : process.argv.includes("--permission")
      ? "permission"
      : "question"
const state = { stage: 0 }
const expectedCalls = scenario === "plan" ? 5 : scenario === "stop" ? 2 : 3
const runtime = await startShellFixture("cli", {
  deferBackend: true,
  ...(scenario === "permission" ? { config: { permission: { "*": "allow", bash: "ask" } } } : {}),
  next: ({ body, text, finished, ancillary }) => {
    if (ancillary) return { content: "Native local fixture" }
    if (text.includes("LOCAL_SECOND_REUSED")) return { content: "LOCAL_REUSED_DONE" }
    if (text.includes("LOCAL_SECOND")) return { content: "LOCAL_SECOND_DONE" }
    state.stage++
    if (scenario === "stop")
      return state.stage === 1
        ? {
            tool: "bash",
            args: {
              command: "echo $$ > local-stop.pid; sleep 30; printf LOCAL_STOP_UNEXPECTED",
              description: "LOCAL_STOP_WAIT",
            },
          }
        : { content: "LOCAL_STOP_UNEXPECTED_CONTINUATION" }
    if (scenario === "plan") {
      if (state.stage === 1) return { tool: "plan_enter", args: {} }
      if (state.stage === 2) {
        const filename = JSON.stringify(body).match(/Draft the plan at ([^;]+);/)?.[1]
        assert.ok(filename)
        return {
          tool: "write",
          args: { path: filename, content: "LOCAL_PLAN_APPROVAL\nReview before implementation." },
        }
      }
      if (state.stage === 3) return { tool: "plan_exit", args: {} }
      return { content: "LOCAL_DONE" }
    }
    if (scenario === "permission")
      return !finished
        ? { tool: "bash", args: { command: "printf LOCAL_PERMISSION_EXECUTED", description: "Local permission" } }
        : { content: "LOCAL_DONE" }
    const question = body.tools
      ?.map((tool) => tool.function?.name ?? tool.name)
      .find((name) => name === "question" || name === "ask_user_question")
    if (!finished) assert.ok(question, "The actual profile must advertise its Question tool")
    return !finished
      ? {
          tool: question,
          args: {
            questions: [
              {
                header: "Native local",
                question: "LOCAL_QUESTION",
                options: [{ label: "Continue", description: "Continue native execution" }],
              },
            ],
          },
        }
      : { content: "LOCAL_DONE" }
  },
})
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
// The compiled channel and source inspector must observe the same owned database.
runtime.env.APEXO_DB = join(runtime.output, "native-local.db")
const output = { text: "" }
const plain = () =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join("\n")
let child
try {
  await Bun.write(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  const launch = (extra = []) => {
    const decoder = new TextDecoder()
    return Bun.spawn(
      [
        ...(process.env.APEXO_TEST_CLI_BIN
          ? [process.env.APEXO_TEST_CLI_BIN]
          : [process.execPath, resolve("src/index.ts")]),
        runtime.directory,
        ...(!compatibility ? ["--session-protocol", "native"] : []),
        ...(!fullscreen ? ["--mini"] : []),
        ...extra,
      ],
      {
        env: {
          ...runtime.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          ...(process.argv.includes("--opposite-worker-mode")
            ? { APEXO_NATIVE_TUI_HOST: compatibility ? "1" : "0" }
            : {}),
        },
        terminal: {
          cols: 120,
          rows: 40,
          data(pty, bytes) {
            const text = decoder.decode(bytes, { stream: true })
            output.text += text
            terminal.write(text)
            for (const _ of text.matchAll(/\x1b\[6n/g)) pty.write("\x1b[1;1R")
          },
        },
      },
    )
  }
  child = launch()
  await poll(() => plain().includes(fullscreen ? "Build" : "ctrl+p cmd"), "local native terminal ready", 30000)
  assert.equal(runtime.calls.length, 0)
  child.terminal.write("LOCAL_FIRST\r")
  if (scenario === "stop") {
    await poll(() => plain().includes("local-stop.pid"), "local native held command", 30000)
    const pid = await poll(
      async () => {
        const file = Bun.file(join(runtime.directory, "local-stop.pid"))
        return (await file.exists()) ? Number(await file.text()) : undefined
      },
      "native local command PID",
      10000,
    )
    child.terminal.write("\x1b")
    await Bun.sleep(150)
    child.terminal.write("\x1b")
    await poll(
      () => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      },
      "native local Stop reaps command",
      10000,
    )
    assert.equal(runtime.calls.length, 1)
    assert.ok(!plain().includes("LOCAL_STOP_UNEXPECTED_CONTINUATION"))
  } else {
    await poll(
      () =>
        plain().includes(
          scenario === "plan"
            ? "Approve this plan and switch to build mode?"
            : scenario === "permission"
              ? "Permission required"
              : "LOCAL_QUESTION",
        ),
      `local native ${scenario}`,
      30000,
    )
    child.terminal.write("\r")
    await poll(() => plain().includes("LOCAL_DONE"), "local native completion", 30000)
  }
  child.terminal.write("LOCAL_SECOND\r")
  await poll(() => plain().includes("LOCAL_SECOND_DONE"), "local native second prompt", 30000)
  assert.equal(runtime.calls.filter((call) => !call.ancillary).length, expectedCalls)
  child.kill("SIGTERM")
  const exit = await deadline(child.exited, 15000, "local native owned shutdown")
  assert.equal(exit, compatibility ? 0 : 143)
  if (!compatibility) {
    const inspection = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
    const { createNativeLocalHost } = await import(${JSON.stringify(resolve("src/cli/native-local-host.ts"))});
    const host = createNativeLocalHost();
    try {
      const request = async path => { const response = await host.fetch("http://apexo.local"+path); if (!response.ok) throw new Error(await response.text()); return response.json() };
      const sessions = (await request("/api/session")).data;
      const messages = sessions.length === 1 ? (await request("/api/session/"+sessions[0].id+"/message?order=asc")).data : [];
      console.log(JSON.stringify({sessions,messages,active:(await request("/api/session/active")).data}));
    } finally { await host.close() }
  `,
      ],
      { cwd: process.cwd(), env: runtime.env, stdout: "pipe", stderr: "pipe" },
    )
    try {
      const [code, stdout, stderr] = await deadline(
        Promise.all([
          inspection.exited,
          new Response(inspection.stdout).text(),
          new Response(inspection.stderr).text(),
        ]),
        30000,
        "native local durable inspection",
      )
      assert.equal(code, 0, stderr)
      const data = JSON.parse(stdout.trim().split("\n").at(-1))
      assert.equal(data.sessions.length, 1)
      assert.equal(data.sessions[0].location.directory, runtime.directory)
      assert.equal(data.messages.filter((message) => message.type === "user").length, 2)
      assert.deepEqual(data.active, {})
      if (resume) {
        child.terminal.close()
        terminal.reset()
        child = launch(["--session", data.sessions[0].id])
        await poll(() => plain().includes("LOCAL_SECOND_DONE"), "native local restored history", 30000)
        assert.equal(runtime.calls.length, expectedCalls, "Opening existing native history must not run the provider")
        child.terminal.write("LOCAL_SECOND_REUSED\r")
        await poll(
          () => runtime.calls.length === expectedCalls + 1 && plain().includes("LOCAL_SECOND_REUSED"),
          "reused native Session prompt",
          30000,
        )
        await poll(() => plain().includes("LOCAL_REUSED_DONE"), "reused native Session completion", 30000)
        child.kill("SIGTERM")
        assert.equal(await deadline(child.exited, 15000, "reused native local shutdown"), 143)
      }
    } finally {
      if (inspection.exitCode === null) inspection.kill("SIGKILL")
      await inspection.exited
    }
  }
  console.log(
    JSON.stringify({
      mode: fullscreen ? "fullscreen" : "mini",
      scenario,
      protocol: compatibility ? "compatibility" : "native",
      checks: compatibility ? 4 : resume ? 7 : 5,
      providerCalls: runtime.calls.length,
      sessionCalls: runtime.calls.filter((call) => !call.ancillary).length,
      ancillaryCalls: runtime.calls.filter((call) => call.ancillary).length,
      output: runtime.output,
    }),
  )
} finally {
  await Bun.write(join(runtime.output, "local-terminal.txt"), plain())
  await Bun.write(join(runtime.output, "local-terminal.ansi"), output.text)
  if (child?.exitCode === null) child.kill("SIGKILL")
  if (child) await child.exited
  child?.terminal?.close()
  terminal.dispose()
  await runtime.close()
  console.error(`Native local evidence: ${runtime.output}`)
}
