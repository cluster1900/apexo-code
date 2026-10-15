// Actual mini/fullscreen native attach, backed by real native Memory management.
import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startMemoryOperationUiFixture } from "./grok-memory-batch-dream-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const desktop = process.argv.includes("--desktop")
const mixed = desktop || process.argv.includes("--mixed")
const fixture = await startMemoryOperationUiFixture({ mixed, runtime: desktop ? "desktop" : "cli", deferred: true })
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--narrow") ? 80 : 100
const rows = process.argv.includes("--narrow") ? 24 : 40
const terminal = new Terminal({ cols, rows, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const memoryView = () => {
  const lines = plain().split("\n")
  const top = lines.findIndex((line) => line.includes("Memory ·"))
  if (top < 0) return ""
  const left = lines[top].indexOf("Memory ·")
  return lines
    .slice(top)
    .map((line) => line.slice(left, fullscreen ? left + 88 : undefined))
    .join("\n")
}
const checks = []
let child
try {
  const before = runtime.calls.length
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(mixed ? ["--session-protocol", "native"] : []),
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--dir",
      runtime.directory,
      "--session",
      fixture.session.id,
    ],
    {
      cwd: join(repo, "packages/apexo"),
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          output.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(
    () => (fullscreen ? /0 running|MEMORY_OPERATION_MAIN/.test(plain()) : plain().includes("ctrl+p cmd")),
    "native terminal ready",
    30000,
  )
  await poll(
    async () =>
      (await fixture.records()).some(
        (item) => item.path === `/api/session/${fixture.session.id}/question` && item.status === 200,
      ),
    "native passive input bootstrap",
  )
  child.terminal.write("/memory")
  await poll(() => /\/memory\s+Browse (saved )?memory/.test(plain()), "Memory autocomplete ready")
  child.terminal.write("\r")
  if (fullscreen) {
    await poll(() => !/\/memory\s+Browse memory/.test(plain()), "Memory autocomplete selection")
    if (plain().includes("> /memory")) child.terminal.write("\r")
  }
  await poll(
    () => memoryView().includes("o operations") && memoryView().includes("Memory enabled for this session"),
    "native Memory ready with operations",
  )
  child.terminal.write("o")
  const operations = () => {
    const lines = plain().split("\n")
    const top = lines.findIndex((line) => line.includes("Memory operations ·"))
    return top < 0 ? "" : lines.slice(top).join("\n")
  }
  const ready = () =>
    poll(
      () => /Memory operations.*Ready/.test(operations()) && operations().includes("d Dream"),
      "operations and Dream command enabled",
    )
  await ready()
  assert.equal(runtime.calls.length, before)
  checks.push("passive-open-with-no-provider-request")
  for (let attempt = 1; attempt <= 3; attempt++) {
    await ready()
    const previous = new Set((await runtime.api(`${fixture.root}/operation`)).map((row) => row.id))
    child.terminal.write("d")
    const dream = await poll(
      async () =>
        (await runtime.api(`${fixture.root}/operation`)).find(
          (row) => !previous.has(row.id) && row.kind === "dream" && row.state === "finished",
        ),
      "actual batch Dream result",
      20000,
    )
    assert.equal(dream.result.status, attempt === 3 ? "completed" : "retry_required")
    assert.equal(dream.result.deferred, attempt === 3 ? 0 : 1)
    assert.equal(dream.result.unplaceable, attempt === 3 ? 1 : 0)
    await ready()
    await poll(
      () =>
        operations().includes(`Deferred notes: ${attempt === 3 ? 0 : 1}`) &&
        operations().includes(`Unplaced notes archived: ${attempt === 3 ? 1 : 0}`),
      "visible batch outcome counts",
    )
    if (attempt < 3) assert.equal(operations().includes("Explicit retry required"), false)
    assert.ok(operations().includes("d Dream"), "the enabled Dream footer remains visible")
    await writeFile(join(runtime.output, `batch-attempt-${attempt}.txt`), plain())
    if (attempt === 1) {
      child.terminal.write("t")
      await poll(
        async () =>
          (await runtime.api(`${fixture.root}/operation`)).some(
            (row) => row.retryOf === dream.id && row.state === "finished",
          ),
        "original retry completion",
        20000,
      )
      await ready()
      assert.equal(fixture.state.dream, 1)
      checks.push("original-retry-retains-partial-outcome-without-replay")
    }
  }
  assert.equal(fixture.state.dream, 3)
  assert.match(await readFile(fixture.file, "utf8"), /BATCH_DREAM_UI_RESULT/)
  checks.push("mixed-result-and-third-deferral-archive-visible")
  assert.ok(
    !(await fixture.records()).some((item) => item.path.includes("/experimental/") && item.path.includes("memory")),
  )
  checks.push("canonical-native-operation-api-only")
  console.log(
    JSON.stringify(
      {
        mode: fullscreen ? "fullscreen" : "mini",
        backend: desktop ? "desktop" : "cli",
        mixed,
        cols,
        rows,
        checks,
        providerCalls: runtime.calls.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await writeFile(join(runtime.output, "memory-active.txt"), plain())
  if (child) {
    child.kill("SIGTERM")
    await deadline(child.exited, 10000, "Memory terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
    child.terminal?.close()
  }
  terminal.dispose()
  await writeFile(join(runtime.output, "memory.ansi"), output.text)
  await writeFile(join(runtime.output, "memory-operations-tui.json"), JSON.stringify({ checks }, null, 2))
  await fixture.close()
  console.error(`Memory TUI evidence: ${runtime.output}`)
}
