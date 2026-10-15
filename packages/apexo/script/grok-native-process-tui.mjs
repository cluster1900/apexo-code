import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import { Terminal } from "@xterm/headless"
import { join } from "node:path"
import { writeFile, rm } from "node:fs/promises"
import { startProcessUiFixture } from "./grok-process-ui-fixture.mjs"
import { poll, deadline } from "./grok-shell-fixture.mjs"

const fullscreen = process.argv.includes("--fullscreen")
const heldRefresh = process.argv.includes("--wait-readiness")
assert.ok(!heldRefresh || fullscreen, "Held refresh proof uses the fullscreen action state")
const desktop = process.argv.includes("--desktop")
const mixed = desktop || process.argv.includes("--mixed")
const cols = process.argv.includes("--narrow") ? 80 : 120
const rows = process.argv.includes("--narrow") ? 24 : 40
const fixture = await startProcessUiFixture({ monitors: true, mixed, runtime: desktop ? "desktop" : "cli" })
const { runtime, session } = fixture
const screen = new Terminal({ cols, rows, allowProposedApi: true })
const output = { text: "" }
const plain = () =>
  Array.from({ length: rows }, (_, row) =>
    screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
// DialogSelect paints disabled action title and shortcut with the same muted
// foreground. A normal enabled title uses text foreground while its shortcut
// remains muted. Inspect the rendered action, not the earlier completion text.
const waitAction = () => {
  for (let row = 0; row < rows; row++) {
    const line = screen.buffer.active.getLine(screen.buffer.active.viewportY + row)
    const text = line?.translateToString(true) ?? ""
    const title = text.indexOf("Wait (10 s)")
    const shortcut = text.indexOf("ctrl+w", title)
    if (title < 0 || shortcut < 0) continue
    const foreground = (column) => {
      const cell = line.getCell(column)
      return [cell.getFgColorMode(), cell.getFgColor()]
    }
    const titleColor = foreground(title)
    const shortcutColor = foreground(shortcut)
    return { row, titleColor, shortcutColor, enabled: JSON.stringify(titleColor) !== JSON.stringify(shortcutColor) }
  }
}
const checks = []
const readiness = { armed: false, waits: 0, held: 0 }
let proxy
let releaseRefresh
const connections = new Set()
const refreshReleased = new Promise((resolve) => {
  releaseRefresh = resolve
})
if (heldRefresh) {
  const backend = runtime.url
  proxy = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, backend)
    if (readiness.armed && incoming.method === "GET" && url.pathname === `/api/session/${session.id}/process`) {
      readiness.held++
      await refreshReleased
    }
    if (outgoing.destroyed) return
    const upstream = request(
      url,
      { method: incoming.method, headers: { ...incoming.headers, host: url.host } },
      (response) => {
        if (
          incoming.method === "POST" &&
          url.pathname === `/api/session/${session.id}/process/${fixture.receipts.MONITOR.id}/wait`
        ) {
          readiness.waits++
          if (readiness.waits === 1) readiness.armed = true
        }
        outgoing.writeHead(response.statusCode, response.headers)
        response.pipe(outgoing)
      },
    )
    upstream.on("error", () => outgoing.destroy())
    outgoing.once("close", () => upstream.destroy())
    incoming.pipe(upstream)
  })
  proxy.on("connection", (socket) => {
    connections.add(socket)
    socket.once("close", () => connections.delete(socket))
  })
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve))
  runtime.url = `http://127.0.0.1:${proxy.address().port}`
}
let child
const capture = (name) => Bun.write(join(runtime.output, `process-tui-${name}.txt`), plain())
try {
  const before = runtime.calls.length
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [
      process.execPath,
      join(fixture.repo, "packages/apexo/src/index.ts"),
      "attach",
      runtime.url,
      ...(!fullscreen ? ["--mini", "--no-replay"] : []),
      "--session-protocol",
      "native",
      "--dir",
      runtime.directory,
      "--session",
      session.id,
    ],
    {
      cwd: join(fixture.repo, "packages/apexo"),
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(pty, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          output.text += text
          screen.write(text)
          if (text.includes("\x1b[6n")) pty.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes("/tasks") && plain().includes("ctrl+p"), "actual terminal command chrome", 30000)
  assert.equal((await fixture.list()).filter((item) => item.status === "running").length, 2)
  const open = async () => {
    child.terminal.write("/tasks")
    await poll(() => /Manage (session )?tasks/.test(plain()), "actual task menu ready")
    child.terminal.write("\r")
    if (fullscreen) {
      await Bun.sleep(120)
      if (/\/tasks.*Manage/.test(plain())) child.terminal.write("\r")
    }
    await poll(
      () => plain().includes("Monitor UI MONITOR") && plain().includes("recent"),
      "actual process manager ready",
    )
  }
  const reveal = async (text) => {
    for (let step = 0; step < 20; step++) {
      if (plain().includes(text)) return
      child.terminal.write("\x1b[6~")
      await Bun.sleep(80)
    }
    assert.ok(plain().includes(text), `Actual output scroll reveals ${text}`)
  }
  await open()
  await poll(() => plain().includes(fixture.receipts.MONITOR.id), "Monitor detail loaded")
  await reveal("No deadline.")
  await reveal("Batches accepted:")
  assert.ok(plain().includes("monitor"))
  await capture("monitor")
  await reveal("MONITOR_READY😀")
  await reveal("MONITOR_ERROR中文")
  await capture("output")
  checks.push("native Task, Shell and Monitor list, metadata and retained output")
  child.terminal.write(fullscreen ? "\x17" : "w")
  await poll(() => plain().includes("Waiting up to 10 seconds"), "real bounded wait starts")
  await poll(() => plain().includes("process is still running"), "real bounded wait times out", 15000)
  if (heldRefresh) {
    await poll(
      () => readiness.held > 0 && waitAction()?.enabled === false,
      "completed text while refresh holds Wait disabled",
    )
    assert.equal(readiness.waits, 1)
    await capture("wait-refresh-held")
    await Bun.write(
      join(runtime.output, "wait-readiness-held.json"),
      JSON.stringify({ ...readiness, action: waitAction() }, null, 2),
    )
    readiness.armed = false
    releaseRefresh()
  }
  if (fullscreen) await poll(() => waitAction()?.enabled, "Wait action enabled after completed refresh")
  await capture("wait-ready")
  if (heldRefresh) {
    await Bun.write(
      join(runtime.output, "wait-readiness-ready.json"),
      JSON.stringify({ ...readiness, action: waitAction() }, null, 2),
    )
    checks.push("held post-wait refresh proves completed text precedes enabled action")
  }
  assert.equal(runtime.calls.length, before)
  assert.equal((await fixture.list()).find((item) => item.id === fixture.receipts.MONITOR.id).status, "running")
  checks.push("passive bounded wait does not stop, rearm or call provider")
  child.terminal.write(fullscreen ? "\x17" : "w")
  await poll(() => plain().includes("Waiting up to 10 seconds"), "second wait starts")
  await runtime.api(`/api/session/${session.id}/process/${fixture.receipts.MONITOR.id}/cancel`, undefined, "POST")
  await poll(() => plain().includes("process has finished"), "joined cancellation settles passive wait")
  checks.push("wait settles after actual joined process cancellation")
  child.terminal.write("\x1b")
  await poll(() => !plain().includes("Up to 100 recent tasks and processes"), "manager closes")
  await open()
  child.terminal.write("\x1b[B")
  await poll(() => plain().includes(fixture.receipts.HOLD.id), "Shell source selected")
  child.terminal.write(fullscreen ? "\x18" : "c")
  await poll(
    async () => (await fixture.list()).find((item) => item.id === fixture.receipts.HOLD.id).status === "cancelled",
    "actual Shell UI cancellation",
  )
  assert.equal(runtime.calls.length, before)
  checks.push("source-qualified Shell cancellation is bodyless and joined")
  if (!mixed) {
    for (const source of ["list", "task-list"]) {
      await writeFile(fixture.fault, JSON.stringify({ action: source, status: 503 }))
      await poll(
        () => plain().includes(source === "list" ? "process list could not" : "task list could not"),
        "independent list error",
      )
      assert.ok(!plain().includes("private fixture process cause"))
      assert.ok(plain().includes("? running"))
      assert.ok(plain().includes(source === "list" ? "Actual subagent task" : "Monitor UI MONITOR"))
      await capture(source)
      await rm(fixture.fault)
      await poll(() => !plain().includes("could not be loaded"), "source recovers")
    }
    checks.push("independent list failures retain other domain without raw cause")
  }
  child.terminal.write("\x1b")
  await poll(() => !plain().includes("Up to 100 recent tasks and processes"), "manager closes before restart receipt")
  await open()
  const all = [
    ...(await fixture.list()).map((item) => ({ ...item, key: `native-process:${item.id}` })),
    { ...fixture.task, key: `native-task:${fixture.task.id}` },
  ].sort((a, b) => b.startedAt - a.startedAt || b.key.localeCompare(a.key))
  const index = all.findIndex((item) => item.id === fixture.receipts.MONITOR_RESTART.id)
  for (let i = 0; i < index; i++) {
    child.terminal.write("\x1b[B")
    await Bun.sleep(50)
  }
  await poll(() => plain().includes(fixture.receipts.MONITOR_RESTART.id), "real interrupted Monitor selected")
  await reveal("Interrupted by a server restart")
  await capture("restart")
  assert.equal(runtime.calls.length, before)
  const records = await fixture.records()
  assert.ok(!records.some((item) => item.path.startsWith("/experimental/")))
  assert.ok(
    records
      .filter((item) => item.path.endsWith("/cancel"))
      .every((item) => item.contentLength === null || item.contentLength === undefined || item.contentLength === "0"),
  )
  checks.push("passive restart receipt and native selected transport without compatibility fallback")
  console.log(
    JSON.stringify(
      {
        fullscreen,
        backend: desktop ? "desktop" : "cli",
        mixed,
        cols,
        rows,
        checks,
        setupProviderCalls: before,
        uiProviderCalls: runtime.calls.length - before,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  releaseRefresh()
  await capture("final")
  await Bun.write(join(runtime.output, "process-tui.ansi"), output.text)
  child?.kill("SIGTERM")
  if (child)
    await deadline(child.exited, 10000, "owned process terminal cleanup").catch(async () => {
      child.kill("SIGKILL")
      await child.exited
    })
  child?.terminal?.close()
  screen.dispose()
  if (proxy) {
    for (const socket of connections) socket.destroy()
    await deadline(new Promise((resolve) => proxy.close(resolve)), 10000, "owned readiness proxy cleanup")
  }
  await fixture.close()
  console.error(`Native Process terminal evidence: ${runtime.output}`)
}
