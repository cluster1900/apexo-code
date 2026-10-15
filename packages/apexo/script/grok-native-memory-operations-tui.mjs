// Actual mini/fullscreen native attach, backed by real native Memory management.
import assert from "node:assert/strict"
import { Terminal } from "@xterm/headless"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startMemoryOperationUiFixture } from "./grok-memory-operation-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const desktop = process.argv.includes("--desktop")
const mixed = desktop || process.argv.includes("--mixed")
const fixture = await startMemoryOperationUiFixture({ mixed, runtime: desktop ? "desktop" : "cli" })
const { runtime, repo } = fixture
const fullscreen = process.argv.includes("--fullscreen")
const cols = process.argv.includes("--narrow") ? 80 : 120
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
  const ready = () => poll(() => /Memory operations.*Ready/.test(operations()), "operations enabled")
  await ready()
  assert.equal(runtime.calls.length, before)
  await poll(
    () => operations().includes("capture") && /Memory operations.*Ready/.test(operations()),
    "restored capture receipt visible",
  )
  await writeFile(join(runtime.output, "operations-restored.txt"), plain())
  checks.push("passive-restored-capture-and-operation-controls")
  child.terminal.write("d")
  const dream = await poll(
    async () =>
      (await runtime.api(`${fixture.root}/operation`)).find(
        (row) => row.kind === "dream" && row.state === "finished" && row.result.status === "completed",
      ),
    "actual Dream completion",
    20000,
  )
  await poll(
    () => operations().includes("dream · finished") && operations().includes("Completed"),
    "visible Dream result",
  )
  await ready()
  assert.equal(fixture.state.dream, 1)
  const clearFile = (await runtime.api(`${fixture.root}/notes`)).find(
    (note) => note.name === "topics/ui-dream-1.md",
  )?.path
  assert.ok(clearFile)
  checks.push("explicit-dream-real-topic-and-visible-result")
  child.terminal.write("t")
  await poll(
    async () =>
      (await runtime.api(`${fixture.root}/operation`)).some(
        (row) => row.retryOf === dream.id && row.state === "finished",
      ),
    "original server-derived retry",
    20000,
  )
  await ready()
  assert.equal(fixture.state.dream, 1)
  checks.push("server-derived-retry-without-provider-replay")
  child.terminal.write("f")
  await poll(
    async () =>
      (await runtime.api(`${fixture.root}/operation`)).some(
        (row) =>
          row.kind === "flush" &&
          row.state === "finished" &&
          row.result.status === "completed" &&
          row.result.processed === 0,
      ),
    "explicit no-work extraction",
    20000,
  )
  await ready()
  child.terminal.write("l")
  await poll(
    () => operations().includes("Memory backend or permission") && /Memory operations.*Ready/.test(operations()),
    "unsupported relocation is visible",
  )
  checks.push("unsupported-legacy-relocation-has-no-fallback")
  child.terminal.write("s")
  await poll(() => /Memory operations · global.*Ready/.test(operations()), "global scope selected")
  child.terminal.write("i")
  await poll(
    () => operations().includes("Migration preview") && /Memory operations.*Ready/.test(operations()),
    "actual carryover preview",
  )
  child.terminal.write("\r")
  await poll(() => operations().includes("Apply exactly this reviewed preview"), "carryover confirmation")
  child.terminal.write("y")
  await poll(
    async () =>
      (await runtime.api(`${fixture.root}/operation`)).some(
        (row) => row.kind === "migration" && row.state === "finished" && row.result.status === "completed",
      ),
    "actual carryover commit",
    20000,
  )
  await ready()
  checks.push("reviewed-carryover-provider-free")
  child.terminal.write("s")
  await poll(() => /Memory operations · workspace.*Ready/.test(operations()), "workspace selected")
  child.terminal.write("p")
  await poll(
    () => operations().includes("discard · Files:") && /Memory operations.*Ready/.test(operations()),
    "discard preview ready",
  )
  if (rows === 24) child.terminal.write("\x1b[6~")
  await poll(
    () => operations().includes("No prepared plan") && /Memory operations.*Ready/.test(operations()),
    "actual unavailable discard preview",
  )
  checks.push("unavailable-discard-reason")
  child.terminal.write("\x1b[5~")
  child.terminal.write("c")
  await poll(
    () => operations().includes("clear · Files:") && /Memory operations.*Ready/.test(operations()),
    "clear preview ready",
  )
  assert.ok(await readFile(clearFile, "utf8"))
  child.terminal.write("\r")
  await poll(() => operations().includes("Confirm with y"), "clear confirmation active")
  if (rows === 24) child.terminal.write("\x1b[6~")
  await poll(() => /cannot be[\s█]*undone/.test(operations()), "explicit irreversible clear confirmation")
  await writeFile(join(runtime.output, "operations-clear-confirm.txt"), plain())
  child.terminal.write("n")
  await poll(
    () =>
      !operations().includes("Recovery preview") &&
      !/cannot be[\s█]*undone/.test(operations()) &&
      /Memory operations.*Ready/.test(operations()),
    "review back completed before preparing again",
  )
  assert.ok(await readFile(clearFile, "utf8"))
  checks.push("review-back-does-not-clear")
  child.terminal.write("\x1b[5~")
  child.terminal.write("c")
  await poll(
    () => operations().includes("clear · Files:") && /Memory operations.*Ready/.test(operations()),
    "fresh clear preview",
  )
  child.terminal.write("\r")
  await poll(() => operations().includes("Confirm with y"), "clear confirmation active")
  if (rows === 24) child.terminal.write("\x1b[6~")
  await poll(() => /cannot be[\s█]*undone/.test(operations()), "fresh clear confirmation")
  child.terminal.write("y")
  await poll(
    async () =>
      (await runtime.api(`${fixture.root}/operation`)).some(
        (row) => row.kind === "recovery" && row.state === "finished" && row.result.committed,
      ),
    "durable clear result",
    20000,
  )
  await ready()
  assert.equal(await readFile(clearFile, "utf8").catch(() => undefined), undefined)
  child.terminal.write("\x1b[6~")
  await poll(() => operations().includes("durably committed"), "scrollable committed result")
  checks.push("explicit-clear-with-durable-receipt-and-scrollable-result")
  assert.ok(
    !(await fixture.records()).some((item) => item.path.includes("/experimental/") && item.path.includes("memory")),
  )
  checks.push("canonical-native-operations-only")
  await writeFile(join(runtime.output, "memory-final.txt"), plain())
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
