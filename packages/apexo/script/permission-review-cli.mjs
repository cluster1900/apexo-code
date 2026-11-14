import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Terminal } from "@xterm/headless"
import { startPermissionReviewFixture } from "./permission-review-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const fixture = await startPermissionReviewFixture({ local: true })
const { runtime, repo } = fixture
const checks = []
const terminal = new Terminal({ cols: 110, rows: 35, allowProposedApi: true })
const screen = []
const plain = () =>
  Array.from({ length: 35 }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const ready = () =>
  plain()
    .split("\n")
    .some((line) => /\bBUILD\b/.test(line) && line.includes("cmd") && !line.includes("interrupt")) &&
  !plain().includes("Permission required")
let child
try {
  for (const format of ["default", "json", "streaming-json"]) {
    const run = Bun.spawn(
      [
        process.execPath,
        join(repo, "packages/apexo/src/index.ts"),
        "run",
        "--session-protocol",
        "native",
        "--dir",
        runtime.directory,
        "--model",
        "reviewfixture/model",
        "--format",
        format,
        "Run bun --version",
      ],
      {
        cwd: join(repo, "packages/apexo"),
        env: runtime.env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      },
    )
    const [stdout, stderr, code] = await deadline(
      Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]),
      30000,
      `headless ${format}`,
    ).finally(() => run.kill())
    await writeFile(join(runtime.output, `permission-headless-${format}.txt`), stdout + stderr)
    assert.equal(code, 0, stderr)
    assert.ok((stdout + stderr).includes("Permission denied; command was not executed: bun --version"), stdout + stderr)
    assert.ok(!(stdout + stderr).includes("Unable to execute command"))
    assert.equal(fixture.state.calls.length, 0, "headless reject must not invoke review")
    checks.push(`headless-${format}-explains-denial`)
  }
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      runtime.directory,
      "--mini",
      "--session-protocol",
      "native",
      "--model",
      "reviewfixture/model",
    ],
    {
      cwd: join(repo, "packages/apexo"),
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 110,
        rows: 35,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.push(text)
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  const type = async (text) => {
    child.terminal.write(`\x1b[200~${text}\x1b[201~`)
    await poll(() => plain().includes(text), "typed composer input")
    child.terminal.write("\r")
  }
  await poll(() => plain().includes("Ask anything"), "local mini composer", 30000)
  await type("/auto")
  await poll(() => plain().includes("Auto-review on"), "local auto mode enabled")
  checks.push("local-auto-enables-review")
  fixture.state.hold = true
  await type("Run bun --version")
  await poll(
    () => plain().includes("Reviewing permission") && plain().includes("once"),
    "local reviewing manual controls",
  )
  await poll(() => fixture.state.calls.length === 1, "local reviewer stream held")
  assert.equal(fixture.state.calls.length, 1)
  child.terminal.write("\r")
  fixture.state.hold = false
  await poll(() => ready() && screen.join("").includes("PERMISSION_DONE"), "local manual approval finishes")
  checks.push("local-single-review-human-approval")
  await type("Run bun --version")
  await poll(() => plain().includes("Fixture requires a human decision"), "local fallback reason")
  child.terminal.write("\x1b")
  await poll(() => plain().includes("Reject permission"), "local rejection confirmation")
  child.terminal.write("\r")
  await poll(
    () => ready() && screen.join("").includes("Permission denied; tool execution stopped"),
    "local denial rendered",
  )
  checks.push("local-fallback-and-accurate-denial")
  await type("/auto")
  await poll(() => plain().includes("Auto-review off"), "local auto disabled")
  child.terminal.write("\x0f")
  await poll(() => /always-approve/i.test(plain()), "local always-approve enabled")
  const before = fixture.state.calls.length
  const completed = fixture.state.completed
  await type("Run bun --version")
  await poll(() => ready() && fixture.state.completed > completed, "local full-auto turn finished")
  assert.equal(fixture.state.calls.length, before)
  checks.push("local-ctrl-o-executes-without-review")
  child.terminal.write("\x03")
  await poll(() => /again to exit/i.test(plain()), "local exit confirmation")
  child.terminal.write("\x03")
  assert.equal(await deadline(child.exited, 10000, "local exit"), 0)
  assert.ok(!/DOMException|AbortError/.test(screen.join("")))
  checks.push("local-clean-double-ctrl-c-exit")
  console.log(JSON.stringify({ checks, output: runtime.output }))
} finally {
  fixture.state.hold = false
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "local cleanup").catch(() => child.kill("SIGKILL"))
  await writeFile(join(runtime.output, "permission-local.ansi"), screen.join(""))
  await writeFile(join(runtime.output, "permission-local.txt"), plain())
  terminal.dispose()
  await fixture.close()
  console.error(`Permission local CLI evidence: ${runtime.output}`)
}
