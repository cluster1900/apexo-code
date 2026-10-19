// Real-terminal check for built-in slash commands typed with arguments (Grok Build 1.0.61/1.0.62 behavior):
// they must run locally and never reach the model as a prompt. Drives `apexo attach` in a PTY against a local fake
// provider and asserts on the composed screen, the fixture's provider calls and the server's session state.
//   bun script/grok-slash-args-tui.mjs --fullscreen
//   bun script/grok-slash-args-tui.mjs            (minimal mode)
import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const requests = []
const runtime = await startShellFixture("cli", {
  next({ text, ancillary }) {
    requests.push({ text, ancillary })
    if (text.includes("SEED_ONE")) return { content: "REPLY_ONE **first** answer" }
    if (text.includes("SEED_TWO")) return { content: "REPLY_TWO second answer" }
    if (text.includes("BTW_SIDE")) return { content: "SIDE_ANSWER_OK" }
    return { content: "UNEXPECTED_MODEL_TURN" }
  },
})
const fullscreen = process.argv.includes("--fullscreen")
const ready = fullscreen ? "0 running" : "Ask anything"
// The mini placeholder disappears after the first prompt; its footer hint marks the composer from then on.
const composer = fullscreen ? "0 running" : "ctrl+p cmd"
const screen = { text: "" }
const terminal = new Terminal({ cols: 140, rows: 45, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const rendered = (text, ms) => poll(() => plain().includes(text), `render ${text}`, ms)
const checks = []
let child
try {
  const session = await runtime.api("/session", { title: "Slash arguments terminal" })
  const target = await runtime.api("/session", { title: "Fix login bug" })
  await runtime.api("/session", { title: "Unrelated work" })
  const messages = async (id = session.id) => runtime.api(`/session/${id}/message`)
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      resolve("src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini"] : []),
      "--dir",
      runtime.directory,
      "--session",
      session.id,
      ...(!fullscreen ? ["--no-replay"] : []),
    ],
    {
      env: {
        ...runtime.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        APEXO_COPY_FILE: join(runtime.output, "last-copy.txt"),
      },
      terminal: {
        cols: 140,
        rows: 45,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await rendered(ready, 30_000)
  const type = async (text) => {
    child.terminal.write(`\x1b[200~${text}\x1b[201~`)
    await poll(() => plain().includes(text.slice(0, 40)), `typed ${text}`)
    child.terminal.write("\r")
  }
  const turns = () => requests.filter((item) => !item.ancillary).length

  // Two real model turns so /copy has responses to pick from.
  await type("SEED_ONE please answer")
  await rendered("REPLY_ONE", 20_000)
  await type("SEED_TWO please answer")
  await rendered("REPLY_TWO", 20_000)
  await poll(async () => (await messages()).length === 4, "seed transcript")
  const baseline = { turns: turns(), messages: (await messages()).length }
  const unchanged = async (name) => {
    await Bun.sleep(400)
    assert.equal(turns(), baseline.turns, `${name} reached the model`)
    assert.equal((await messages()).length, baseline.messages, `${name} added a message`)
    assert.ok(!plain().includes("UNEXPECTED_MODEL_TURN"), `${name} produced a model turn`)
  }

  // /copy N path writes the Nth-latest response to a new file; a taken path is refused and left unchanged.
  const copyFile = join(runtime.output, "copy-2.md")
  await type(`/copy 2 ${copyFile}`)
  await poll(async () => (await readFile(copyFile, "utf8").catch(() => "")) === "REPLY_ONE **first** answer", "copy 2 file")
  assert.equal(await readFile(join(runtime.output, "last-copy.txt"), "utf8"), "REPLY_ONE **first** answer")
  await unchanged("/copy 2 <path>")
  const taken = join(runtime.output, "taken.txt")
  await writeFile(taken, "KEEP_ME")
  await type(`/copy ${taken}`)
  await rendered("already exists")
  assert.equal(await readFile(taken, "utf8"), "KEEP_ME")
  await unchanged("/copy <existing>")
  checks.push("copy-nth-response-to-new-file", "copy-refuses-existing-file", "copy-backup-file")

  // Mid-message /btw becomes a side question; nothing goes to the main turn.
  await type("fix the parser first. /btw what is BTW_SIDE?")
  await rendered("SIDE_ANSWER_OK", 20_000)
  const side = await runtime.api(`/session/${session.id}/side-question`)
  assert.equal(side.at(-1).question, "fix the parser first. what is BTW_SIDE?")
  assert.equal((await messages()).length, baseline.messages)
  assert.ok(!(await messages()).some((item) => JSON.stringify(item).includes("fix the parser first")))
  baseline.turns = turns()
  checks.push("mid-message-btw-is-side-question")
  child.terminal.write("\x1b[27u")
  await poll(() => plain().includes(composer) && !plain().includes("Side questions"), "side-question panel closed")

  if (fullscreen) {
    // /rename <title> sets the title directly.
    await type("/rename Renamed by slash")
    await poll(async () => (await runtime.api(`/session/${session.id}`)).title === "Renamed by slash", "renamed")
    await unchanged("/rename")
    checks.push("rename-with-argument")

    // /export <file> writes the transcript to a new file and refuses a taken name.
    const exported = join(runtime.output, "export.md")
    await type(`/export ${exported}`)
    await poll(async () => (await readFile(exported, "utf8").catch(() => "")).includes("REPLY_TWO"), "exported")
    await writeFile(exported, "EXPORT_KEEP")
    await type(`/export ${exported}`)
    await rendered("already exists")
    assert.equal(await readFile(exported, "utf8"), "EXPORT_KEEP")
    await unchanged("/export")
    checks.push("export-to-new-file", "export-refuses-existing-file")

    // /model <name> selects the model locally.
    await type("/model grok-4.7")
    await rendered("Model set to xai/grok-4.7")
    await unchanged("/model")
    checks.push("model-with-argument")

    // /feedback <message> saves a local draft.
    await type("/feedback SLASH_FEEDBACK the copy flow works")
    await poll(
      async () => (await runtime.api(`/session/${session.id}/feedback`)).some((item) => item.title.includes("SLASH_FEEDBACK")),
      "feedback draft",
    )
    await unchanged("/feedback")
    checks.push("feedback-with-argument")

    // Generic guard: a built-in without an argument handler runs and says the text was ignored.
    await type("/timestamps please")
    await rendered("takes no arguments")
    await unchanged("/timestamps <args>")
    checks.push("builtin-without-handler-runs-locally")

    // /resume <words>: no exact match opens the picker filtered with Grok's every-word rule.
    await type("/resume login fix")
    await rendered("Sessions")
    await rendered("Fix login bug")
    assert.ok(!plain().includes("Unrelated work"), "resume picker filter")
    child.terminal.write("\x1b[27u")
    await rendered(ready)
    await unchanged("/resume <words>")
    checks.push("resume-picker-every-word-filter")

    // /resume <exact title> opens that session directly; renaming there proves the navigation.
    await type("/resume Fix login bug")
    await poll(() => !plain().includes("REPLY_TWO"), "left the original session")
    await type("/rename Resumed directly")
    await poll(async () => (await runtime.api(`/session/${target.id}`)).title === "Resumed directly", "resumed session")
    assert.deepEqual(await messages(target.id), [])
    await unchanged("/resume <title>")
    checks.push("resume-exact-title-opens-session")
  }

  if (!fullscreen) {
    // Fullscreen-only built-ins print a notice instead of prompting the model.
    await type("/compact now")
    await rendered("/compact isn't available in minimal mode")
    await unchanged("/compact")
    await type("/resume login fix")
    await rendered("/resume isn't available in minimal mode")
    await unchanged("/resume")
    checks.push("minimal-builtin-notice")
  }

  assert.equal(turns(), baseline.turns)
  console.log(JSON.stringify({ mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output }))
} finally {
  const snapshot = plain()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "slash-args PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "slash-args-tui.txt"), snapshot)
  terminal.dispose()
  await writeFile(join(runtime.output, "slash-args-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "slash-args-tui.json"), JSON.stringify({ checks, requests }, null, 2))
  await runtime.close()
  console.error(`Slash args TUI evidence: ${runtime.output}`)
}
