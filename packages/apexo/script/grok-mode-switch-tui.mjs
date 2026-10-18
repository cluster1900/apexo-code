// Grok Build `/minimal` ↔ `/fullscreen`: one local `apexo` process switches renderers on the same session.
// --from-mini starts with `--mini` and goes mini → fullscreen → mini.
import assert from "node:assert/strict"
import { resolve } from "node:path"
import { Terminal } from "@xterm/headless"
import { deadline, poll } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"

const fromMini = process.argv.includes("--from-mini")
const { runtime } = await startGoalFixture("cli", {
  next: ({ text, ancillary }) => {
    if (ancillary) return
    const marker = text.match(/MODE_[A-Z_]+/)?.[0]
    if (marker) return { content: `REPLY_${marker}` }
  },
})
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true, scrollback: 2000 })
const screen = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
// Inline output lives in scrollback; read the whole normal buffer for the minimal renderer.
const all = () =>
  Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true),
  ).join("\n")
const alternate = () => terminal.buffer.active.type === "alternate"
const checks = []
const raw = []
let child
try {
  const model = { providerID: "xai", id: "grok-4.7" }
  const session = await runtime.api("/session", { title: "Mode switch", agent: "build", model })
  await runtime.api(`/session/${session.id}/message`, {
    agent: "build",
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "MODE_FIRST" }],
  })
  const users = async () =>
    (await runtime.api(`/session/${session.id}/message`))
      .filter((item) => item.info.role === "user")
      .flatMap((item) => item.parts.filter((part) => part.type === "text").map((part) => part.text))
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
      runtime.directory,
      "--session",
      session.id,
      ...(fromMini ? ["--mini"] : []),
    ],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          terminal.write(text)
          raw.push(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  const type = async (text) => {
    child.terminal.write(`\x1b[200~${text}\x1b[201~`)
    await Bun.sleep(300)
    child.terminal.write("\r")
  }
  const fullscreen = async (marker) => {
    await poll(() => alternate() && screen().includes(marker), `fullscreen shows ${marker}`, 30_000)
  }
  const minimal = async (marker) => {
    await poll(() => !alternate() && all().includes(marker), `minimal shows ${marker}`, 30_000)
  }
  const send = async (marker) => {
    await type(marker)
    await poll(async () => (await users()).includes(marker), `${marker} reached the session`, 30_000)
  }

  if (!fromMini) {
    await fullscreen("REPLY_MODE_FIRST")
    await type("/minimal")
    await minimal("MODE_FIRST")
    checks.push("fullscreen-to-minimal-keeps-session-transcript")
    await Bun.sleep(2500)
    await send("MODE_MINI")
    await minimal("REPLY_MODE_MINI")
    checks.push("minimal-prompts-go-to-the-same-session")
    await type("/fullscreen")
    await fullscreen("REPLY_MODE_MINI")
    checks.push("minimal-to-fullscreen-restores-session")
    await Bun.sleep(500)
    await send("MODE_FULL")
    await fullscreen("REPLY_MODE_FULL")
    checks.push("fullscreen-after-round-trip-works")
  } else {
    await minimal("REPLY_MODE_FIRST")
    await type("/full")
    await fullscreen("REPLY_MODE_FIRST")
    checks.push("mini-launch-to-fullscreen-keeps-session")
    await Bun.sleep(500)
    await type("/minimal")
    await minimal("MODE_FIRST")
    // The attached mini replays history before its footer takes input.
    await Bun.sleep(2500)
    await send("MODE_BACK")
    await minimal("REPLY_MODE_BACK")
    checks.push("back-to-minimal-shares-the-backend")
  }
  assert.deepEqual(
    (await runtime.api("/session")).filter((item) => item.title === "Mode switch").length,
    1,
    "no extra session was created",
  )
  checks.push("single-session")
  console.log(JSON.stringify({ fromMini, checks, output: runtime.output }, null, 2))
} catch (error) {
  console.error(screen(), "\nRAW:", JSON.stringify(raw.join("").slice(-3000)))
  throw error
} finally {
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  await runtime.close()
  console.error(`Mode switch evidence: ${runtime.output}`)
}
