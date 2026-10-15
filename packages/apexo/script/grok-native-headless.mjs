import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import { startShellFixture, deadline, poll } from "./grok-shell-fixture.mjs"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"

const attach = process.argv.includes("--attach")
const mixed = process.argv.includes("--mixed")
const desktop = process.argv.includes("--desktop")
assert.ok(!desktop || (attach && mixed), "--desktop requires --attach --mixed")
const next = ({ text, finished }) => {
  if (finished) return { content: "NATIVE_HEADLESS_DONE" }
  if (text.includes("HEADLESS_FILE")) {
    assert.ok(text.includes("EXPLICIT_FILE_CONTENT"), "decoded text must reach the current user input")
    assert.ok(text.includes("headless-attachment.txt"))
    assert.ok(!text.includes("data:text/plain"))
    return { content: "TEXT_VISIBLE" }
  }
  if (text.includes("HEADLESS_IMAGE")) {
    assert.ok(text.includes("data:image/png;base64,"), "supported image must reach the actual provider request")
    return { content: "IMAGE_VISIBLE" }
  }
  if (text.includes("HEADLESS_LATER")) return { content: "LATER_ONLY" }
  if (text.includes("HEADLESS_TASK_CHILD"))
    return {
      tool: "bash",
      args: { command: "printf DENIED > headless-child-denied.txt", description: "Inherited hard deny" },
    }
  if (text.includes("HEADLESS_TASK_PARENT"))
    return {
      tool: "task",
      args: { description: "Owned foreground", prompt: "HEADLESS_TASK_CHILD", subagent_type: "general" },
    }
  if (text.includes("HEADLESS_TASK_BACKGROUND"))
    return {
      tool: "task",
      args: {
        description: "No detached task",
        prompt: "UNEXPECTED_DETACHED_CHILD",
        subagent_type: "general",
        background: true,
      },
    }
  if (text.includes("HEADLESS_QUESTION"))
    return {
      tool: "question",
      args: {
        questions: [{ header: "No operator", question: "MUST_NOT_WAIT", options: [{ label: "A", description: "A" }] }],
      },
    }
  if (text.includes("HEADLESS_DENIED"))
    return { tool: "bash", args: { command: "printf DENIED > headless-denied.txt", description: "Hard deny" } }
  if (text.includes("HEADLESS_ASK"))
    return { tool: "bash", args: { command: "printf ALLOWED > headless-allowed.txt", description: "Ask permission" } }
  if (text.includes("HEADLESS_SIGNAL"))
    return {
      tool: "bash",
      args: {
        command: "echo $$ > headless-signal.pid; sleep 30; printf UNEXPECTED_SIGNAL_CONTINUATION",
        description: "Held native process",
      },
    }
  return { content: "NATIVE_HEADLESS_DONE" }
}
const config = { permission: { "*": "allow", bash: { "*": "ask", "*DENIED*": "deny" } } }
const hosted = attach
  ? await startPlanUiFixture({ mixed, runtime: desktop ? "desktop" : "cli", next, config })
  : undefined
const fixture = hosted?.runtime ?? (await startShellFixture("cli", { deferBackend: true, next, config }))
const results = []
const command = (text, format = "json", extra = []) => [
  ...(process.env.APEXO_TEST_CLI_BIN ? [process.env.APEXO_TEST_CLI_BIN] : [process.execPath, resolve("src/index.ts")]),
  "run",
  "--session-protocol",
  "native",
  ...(attach ? ["--attach", fixture.url] : []),
  "--dir",
  fixture.directory,
  "--model",
  "xai/grok-4.7",
  ...extra,
  "--format",
  format,
  text,
]
const execute = async (label, text, format = "json", extra = [], signal) => {
  const start = fixture.calls.length
  const child = Bun.spawn(command(text, format, extra), {
    env: fixture.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const captured = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  try {
    if (signal) {
      await poll(
        () => Bun.file(join(fixture.directory, "headless-signal.pid")).exists(),
        "actual held process PID",
        20000,
      )
      child.kill(signal)
    }
    const [code, [stdout, stderr]] = await deadline(Promise.all([child.exited, captured]), 30000, label)
    await Bun.write(join(fixture.output, `${label}.json`), JSON.stringify({ code, stdout, stderr }, null, 2))
    const events =
      format === "default" || !stdout.trim()
        ? []
        : stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
    const result = { label, code, stdout, stderr, events, providerCalls: fixture.calls.length - start }
    results.push({ label, code, providerCalls: result.providerCalls })
    return result
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
}
try {
  if (!attach) fixture.env.APEXO_DB = join(fixture.output, "headless.db")
  await Bun.write(join(fixture.directory, "apexo.json"), fixture.env.APEXO_CONFIG_CONTENT)
  for (const format of ["default", "json", "streaming-json"]) {
    const result = await execute(format, `HEADLESS_${format}`, format)
    assert.equal(result.code, 0, result.stderr + result.stdout)
    assert.ok(result.stdout.includes("NATIVE_HEADLESS_DONE"))
    assert.equal(result.providerCalls, 1)
    if (format !== "default") {
      const terminal = result.events.filter((event) => event.type === "input_execution")
      assert.equal(terminal.length, 1)
      assert.equal(terminal[0].status, "completed")
      if (format === "streaming-json") assert.equal(result.events.at(-1).type, "end")
      if (format === "json") {
        const extra = ["--session", terminal[0].sessionID, "--input-id", terminal[0].inputID]
        const retry = await execute("retry", "HEADLESS_json", format, extra)
        assert.equal(retry.code, 0, retry.stderr)
        assert.equal(retry.providerCalls, 0)
        assert.equal(retry.events.filter((event) => event.type === "text").length, 1)
        assert.equal(retry.events.find((event) => event.type === "input_execution").inputID, terminal[0].inputID)
        const later = await execute("later", "HEADLESS_LATER", format, ["--session", terminal[0].sessionID])
        assert.equal(later.code, 0, later.stderr)
        assert.equal(later.providerCalls, 1)
        assert.ok(!later.stdout.includes("NATIVE_HEADLESS_DONE"))
        const older = await execute("retry-after-later", "HEADLESS_json", format, extra)
        assert.equal(older.code, 0, older.stderr)
        assert.equal(older.providerCalls, 0)
        assert.ok(!older.stdout.includes("LATER_ONLY"))
        const conflict = await execute("conflict", "DIFFERENT_INPUT", format, extra)
        assert.notEqual(conflict.code, 0)
        assert.equal(conflict.providerCalls, 0)
        assert.ok(!conflict.stdout.includes("NATIVE_HEADLESS_DONE"))
      }
    }
  }
  if (attach) {
    const file = join(fixture.directory, "headless-attachment.txt")
    await Bun.write(file, "EXPLICIT_FILE_CONTENT")
    const attachedText = await execute("text-attachment", "HEADLESS_FILE", "json", ["--file", file])
    assert.equal(attachedText.code, 0, attachedText.stderr)
    assert.equal(attachedText.providerCalls, 1)
    assert.equal(attachedText.events.find((event) => event.type === "input_execution").status, "completed")
    assert.ok(attachedText.events.some((event) => event.type === "text" && event.part.text === "TEXT_VISIBLE"))
    const image = join(fixture.directory, "headless-image.png")
    await Bun.write(
      image,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==",
        "base64",
      ),
    )
    const attached = await execute("image-attachment", "HEADLESS_IMAGE", "json", ["--file", image])
    assert.equal(attached.code, 0, attached.stderr + attached.stdout)
    assert.equal(attached.providerCalls, 1)
    assert.ok(attached.stdout.includes("IMAGE_VISIBLE"))
  }
  const rejected = await execute("ask-rejected", "HEADLESS_ASK")
  assert.equal(rejected.code, 0, rejected.stderr)
  assert.equal(rejected.providerCalls, 2)
  assert.equal(await Bun.file(join(fixture.directory, "headless-allowed.txt")).exists(), false)
  assert.equal(rejected.events.find((event) => event.type === "tool_use").part.state.status, "error")
  const approved = await execute("ask-approved", "HEADLESS_ASK", "streaming-json", ["--auto"])
  assert.equal(approved.code, 0, approved.stderr)
  assert.equal(await Bun.file(join(fixture.directory, "headless-allowed.txt")).text(), "ALLOWED")
  assert.equal(approved.providerCalls, 2)
  const denied = await execute("hard-denied", "HEADLESS_DENIED", "json", ["--auto"])
  assert.equal(denied.code, 0, denied.stderr)
  assert.equal(await Bun.file(join(fixture.directory, "headless-denied.txt")).exists(), false)
  assert.equal(denied.events.find((event) => event.type === "tool_use").part.state.status, "error")
  const question = await execute("question", "HEADLESS_QUESTION", "json", ["--auto"])
  assert.equal(question.code, 0, question.stderr)
  assert.equal(question.providerCalls, 2)
  assert.equal(question.events.find((event) => event.type === "tool_use").part.state.status, "error")
  const foreground = await execute("foreground-task", "HEADLESS_TASK_PARENT", "json", ["--auto"])
  assert.equal(foreground.code, 0, foreground.stderr)
  assert.equal(foreground.providerCalls, 4)
  assert.equal(await Bun.file(join(fixture.directory, "headless-child-denied.txt")).exists(), false)
  assert.equal(foreground.events.find((event) => event.type === "tool_use").part.tool, "task")
  const background = await execute("background-task-rejected", "HEADLESS_TASK_BACKGROUND", "json", ["--auto"])
  assert.equal(background.code, 0, background.stderr)
  assert.equal(background.providerCalls, 2)
  assert.equal(background.events.find((event) => event.type === "tool_use").part.state.status, "error")
  for (const signal of ["SIGINT", "SIGTERM"]) {
    await Bun.file(join(fixture.directory, "headless-signal.pid"))
      .delete()
      .catch(() => {})
    const result = await execute(signal, "HEADLESS_SIGNAL", "json", ["--auto"], signal)
    assert.equal(result.code, signal === "SIGINT" ? 130 : 143, result.stderr)
    assert.equal(result.providerCalls, 1)
    assert.equal(result.events.find((event) => event.type === "input_execution").status, "interrupted")
    const pid = Number(await Bun.file(join(fixture.directory, "headless-signal.pid")).text())
    assert.throws(() => process.kill(pid, 0), "joined cancellation must reap the owned process")
    assert.ok(
      !result.events.some(
        (event) =>
          (event.type === "text" && event.part.text.includes("UNEXPECTED_SIGNAL_CONTINUATION")) ||
          (event.type === "tool_use" &&
            event.part.state.status === "completed" &&
            event.part.state.output.includes("UNEXPECTED_SIGNAL_CONTINUATION")),
      ),
    )
  }
  console.log(
    JSON.stringify({
      channel: attach ? (mixed ? "mixed-attach" : "native-attach") : "native-local",
      cli: process.env.APEXO_TEST_CLI_BIN ? "compiled" : "source",
      backend: desktop ? "packaged-desktop" : attach ? "source-server" : "embedded",
      checks: results.length,
      results,
      providerCalls: fixture.calls.length,
    }),
  )
} finally {
  if (hosted) await hosted.close()
  else await fixture.close()
  console.error(`Native headless evidence: ${fixture.output}`)
}
