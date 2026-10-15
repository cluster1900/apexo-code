import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Terminal } from "@xterm/headless"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const capture = process.argv.includes("--capture")
const v2Dream = process.argv.includes("--v2-dream")
const planned = {
  content: capture
    ? JSON.stringify({
        outcome: "observations",
        observations: [
          { type: "project", statement: "CAPTURE_TUI_SAVED", topic_hint: null, keywords: [], aliases: [], body: null },
        ],
      })
    : "## Decisions\nWORK_TUI_SAVED",
  hold: capture ? Promise.withResolvers() : undefined,
}
const calls = []
const runtime = await startShellFixture("cli", {
  config: {
    ...(capture || v2Dream ? { memory_v2: { enabled: true, automatic_dream_enabled: false } } : {}),
    memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ input, body }) {
    if (v2Dream) {
      if (JSON.stringify(input).includes("You extract durable memory observations"))
        return { content: JSON.stringify({ outcome: "noop", observations: [] }) }
      if (!JSON.stringify(input).includes("Consolidate durable memory observations into topic Markdown")) return
      const message = input.findLast((row) => row.role === "user").content
      const value = JSON.parse(typeof message === "string" ? message : message.map((part) => part.text ?? "").join(""))
      calls.push(body)
      if (planned.hold) await planned.hold.promise
      return {
        content: JSON.stringify({
          operations: ["database", "testing"].map((name) => ({
            action: value.topics.some((row) => row.path === `topics/${name}.md`) ? "update" : "create",
            path: `topics/${name}.md`,
            content: `# ${name}\nDREAM_UI_SAVED: use WAL and bounded retries.`,
            evidence: value.observations.map((row) => row.path),
          })),
        }),
      }
    }
    if (
      !JSON.stringify(input).includes(
        capture ? "You extract durable memory observations" : "You are a memory assistant",
      )
    )
      return
    const content = planned.content
    calls.push(body)
    if (planned.hold) await planned.hold.promise
    return { content }
  },
})
const fullscreen = process.argv.includes("--fullscreen")
const screen = { text: "" }
// OpenTUI sends changed cells only; assertions need the composed terminal screen.
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const rendered = (text) => poll(() => plain().includes(text), `render ${text}`)
const checks = []
let child
try {
  const session = await runtime.api("/session", { title: "Memory work verification" })
  const endpoint = `/experimental/session/${session.id}/memory`
  const notes = () => runtime.api(endpoint)
  await runtime.api(`/session/${session.id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Use WAL for concurrent readers." }],
  })
  const before = await runtime.api(`/session/${session.id}/message`)
  const operation = () => runtime.api(`${endpoint}/operation`)
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
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "terminal ready", 30_000)
  const open = async (name) => {
    child.terminal.write(`\x1b[200~/${name} \x1b[201~`)
    await poll(() => plain().includes(`/${name}`), "command entered")
    child.terminal.write("\r")
  }
  if (v2Dream) {
    await runtime.api(`${endpoint}/remember`, { content: "Use SQLite WAL", scope: "workspace" })
    planned.hold = Promise.withResolvers()
    await open("dream")
    await rendered("Consolidating saved notes")
    await poll(() => calls.length === 1, "Dream request")
    const active = await operation()
    child.terminal.write("\x1b[27u")
    await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "Dream panel closed")
    await open("dream")
    await rendered("Consolidating saved notes")
    assert.equal((await operation()).id, active.id)
    child.terminal.write("x")
    await rendered("Memory operation cancelled.")
    planned.hold.resolve()
    planned.hold = undefined
    child.terminal.write("d")
    await rendered("Memory operation completed.")
    const result = (await operation()).result
    assert.equal(result.topics, 2)
    assert.equal(result.cleaned, 1)
    await rendered("Topics: 2")
    assert.match(await readFile(join(result.path, "topics/database.md"), "utf8"), /DREAM_UI_SAVED/)
    assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
    child.terminal.write("d")
    await rendered("No new memory to save.")
    checks.push(
      "v2-slash-dream-progress",
      "v2-close-reopen-same-dream",
      "v2-cancel-retry-dream",
      "v2-topic-count",
      "v2-written-topics",
      "v2-no-main-turn",
      "v2-dream-no-work",
    )
  } else if (capture) {
    await open("flush")
    await rendered("Memory operations")
    await rendered("Extracting durable knowledge")
    const active = await operation()
    child.terminal.write("\x1b[27u")
    await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "capture panel closed")
    await open("flush")
    await rendered("Extracting durable knowledge")
    assert.equal((await operation()).id, active.id)
    child.terminal.write("x")
    await rendered("Memory operation cancelled.")
    planned.hold.resolve()
    planned.hold = undefined
    child.terminal.write("f")
    await rendered("Memory operation completed.")
    assert.equal((await operation()).result.processed, 1)
    assert.equal(calls.length, 1)
    assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
    await writeFile(join(runtime.output, "memory-capture-terminal.txt"), plain())
    checks.push(
      "v2-slash-flush-barrier",
      "v2-close-and-reopen-same-barrier",
      "v2-cancel-wait-and-rejoin",
      "v2-completion-count",
      "v2-no-extra-extraction-or-main-turn",
    )
    const content = planned.content
    planned.content = "INVALID_CAPTURE_OUTPUT"
    planned.hold = Promise.withResolvers()
    child.terminal.write("\x1b[27u")
    await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "retry capture panel closed")
    await runtime.api(`/session/${session.id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: "Retry failed memory extraction explicitly." }],
    })
    await poll(() => calls.length === 2, "retryable extraction held")
    await open("flush")
    await rendered("Extracting durable knowledge")
    planned.hold.resolve()
    planned.hold = undefined
    await rendered("Capture needs a retry. Run extraction again.")
    assert.equal((await operation()).result.status, "retry_required")
    // The first /flush may join extraction or explicitly retry if its admission
    // finishes after the held response. Both must leave one user retry available.
    const retries = calls.length
    assert.ok(retries === 2 || retries === 3)
    await writeFile(join(runtime.output, "memory-capture-retry-terminal.txt"), plain())
    planned.content = content
    child.terminal.write("f")
    await rendered("Memory operation completed.")
    assert.equal(calls.length, retries + 1)
    checks.push("v2-retry-required-visible", "v2-explicit-retry-key-completes")
  } else {
    planned.hold = Promise.withResolvers()
    await open("flush")
    await poll(() => plain().includes("Memory operations"), "operation panel")
    await poll(() => plain().includes("Extracting durable knowledge"), "running progress")
    await poll(() => calls.length === 1, "memory model request")
    assert.equal(calls.length, 1)
    const active = await operation()
    child.terminal.write("\x1b[27u")
    await poll(() => plain().includes(fullscreen ? "0 running" : "ctrl+p cmd"), "panel closed")
    assert.equal((await operation()).id, active.id)
    await open("memory")
    await poll(() => plain().includes("o operations"), "memory browser")
    child.terminal.write("o")
    await rendered("Memory operations")
    await rendered("Extracting durable knowledge")
    assert.equal(calls.length, 1)
    checks.push("slash-opens-operation", "running-progress", "close-keeps-running", "reopen-without-restart")
    child.terminal.write("x")
    await poll(async () => (await operation()).result?.status === "cancelled", "cancelled")
    planned.hold.resolve()
    planned.hold = undefined
    await rendered("Memory operation cancelled.")
    child.terminal.write("f")
    await poll(async () => (await operation()).result?.status === "completed", "retry completed")
    await rendered("Memory operation completed.")
    const result = (await operation()).result
    assert.match(await readFile(result.path, "utf8"), /WORK_TUI_SAVED/)
    assert.deepEqual(await runtime.api(`/session/${session.id}/message`), before)
    checks.push("cancel", "retry", "result-saved", "no-main-turn")
    child.terminal.write("f")
    await poll(async () => (await operation()).result?.status === "no_work", "no new work")
    await rendered("No new memory to save.")
    await runtime.api(`${endpoint}/toggle`, { enabled: false })
    child.terminal.write("d")
    await poll(
      async () => (await operation()).kind === "dream" && (await operation()).result?.status === "disabled",
      "disabled dream",
    )
    await rendered("Memory is disabled for this session.")
    checks.push("no-work-result", "disabled-dream-result")
  }
  console.log(
    JSON.stringify(
      {
        mode: fullscreen ? "fullscreen" : "mini",
        capture,
        v2Dream,
        passed: checks.length,
        checks,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  const snapshot = plain()
  planned.hold?.resolve()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "memory PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "memory-work-tui.ansi"), screen.text)
  await writeFile(join(runtime.output, "memory-work-tui.txt"), snapshot)
  terminal.dispose()
  await writeFile(join(runtime.output, "memory-work-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
  console.error(`Memory operation TUI evidence: ${runtime.output}`)
}
