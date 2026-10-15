// Actual native attach, with synthetic local media provider results; no paid generation.
import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { join } from "node:path"
import { startMediaUiFixture } from "./grok-media-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const fixture = await startMediaUiFixture()
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = 120
const rows = 40
const checks = []
try {
  const before = runtime.calls.length
  const probe = await fetch(
    `${runtime.url}/session/${fixture.sessions[0].id}?directory=${encodeURIComponent(runtime.directory)}`,
  )
  await Bun.write(
    join(runtime.output, "legacy-bootstrap-response.json"),
    JSON.stringify({ status: probe.status, body: await probe.text() }),
  )
  for (const session of fixture.sessions.slice(0, 4)) {
    const legacyMessages = await fetch(
      `${runtime.url}/session/${session.id}/message?directory=${encodeURIComponent(runtime.directory)}`,
    )
    const nativeMessages = await runtime.api(`/api/session/${session.id}/message?order=asc`)
    await Bun.write(
      join(runtime.output, `${session.name}-transcript-contract.json`),
      JSON.stringify({
        native: nativeMessages,
        legacy: { status: legacyMessages.status, body: await legacyMessages.text() },
      }),
    )
    const terminal = new Terminal({ cols, rows, allowProposedApi: true })
    const screen = { text: "" }
    const plain = () =>
      Array.from({ length: rows }, (_, row) =>
        terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
      ).join("\n")
    const decoder = new TextDecoder()
    const child = Bun.spawn(
      [
        process.execPath,
        join(repo, "packages/apexo/src/index.ts"),
        "attach",
        runtime.url,
        ...(!fullscreen ? ["--mini"] : []),
        "--dir",
        runtime.directory,
        "--session",
        session.id,
      ],
      {
        cwd: join(repo, "packages/apexo"),
        env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        terminal: {
          cols,
          rows,
          data(pty, bytes) {
            const text = decoder.decode(bytes, { stream: true })
            screen.text += text
            terminal.write(text)
            if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
          },
        },
      },
    )
    try {
      await poll(() => plain().includes("NATIVE_MEDIA_DONE"), `native ${session.name} transcript`, 30000)
      if (fullscreen && !plain().includes(session.path.split("/").at(-1))) {
        child.terminal.write("\x10")
        await poll(() => plain().includes("Commands"), "command palette")
        child.terminal.write("Show generic tool output")
        await poll(() => plain().includes("Show generic tool output"), "generic output action")
        child.terminal.write("\r")
      }
      await poll(() => plain().includes(session.path.split("/").at(-1)), `saved ${session.name} path`)
      assert.ok(plain().includes(session.name))
      await Bun.write(join(runtime.output, `${session.name}-${fullscreen ? "fullscreen" : "mini"}.txt`), plain())
      checks.push(`${session.name}-saved-path-visible`)
    } finally {
      await Bun.write(join(runtime.output, `${session.name}.ansi`), screen.text)
      await Bun.write(join(runtime.output, `${session.name}-last.txt`), plain())
      child.kill("SIGTERM")
      await deadline(child.exited, 10000, "owned media terminal cleanup").catch(async () => {
        child.kill("SIGKILL")
        await child.exited
      })
      child.terminal.close()
      terminal.dispose()
    }
  }
  assert.equal(runtime.calls.length, before)
  assert.equal((await fixture.records()).filter((row) => row.path.startsWith("/api/fs/read/")).length, 0)
  checks.push("terminal-passive-no-model-or-preview-read")
  console.log(
    JSON.stringify(
      { kind: fullscreen ? "fullscreen" : "mini", checks, providerCalls: runtime.calls.length, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
  console.error(`Media terminal evidence: ${runtime.output}`)
}
