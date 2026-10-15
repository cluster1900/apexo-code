import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"
const runtime = await startShellFixture("cli")
const fullscreen = process.argv.includes("--fullscreen")
let child
let transcript = ""
let offset = 0
const plain = () => transcript.slice(offset).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
const checks = []
try {
  const session = await runtime.api("/session", { title: "Plugins terminal verification" })
  const source = join(runtime.output, "catalog")
  const plugin = join(source, "plugins", "terminal-plugin")
  await mkdir(join(source, ".grok-plugin"), { recursive: true })
  await mkdir(join(plugin, "skills", "hello"), { recursive: true })
  await writeFile(
    join(source, ".grok-plugin", "marketplace.json"),
    JSON.stringify({
      name: "Terminal",
      plugins: [{ name: "terminal-plugin", source: "./plugins/terminal-plugin", description: "Terminal plugin" }],
    }),
  )
  await writeFile(join(plugin, "plugin.json"), JSON.stringify({ name: "terminal-plugin", version: "1.0.0" }))
  await writeFile(join(plugin, "skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: Hello\n---\nHello")
  const catalog = await runtime.api("/plugins/manage", { action: "add-source", source })
  const id = catalog.items[0].id
  const status = async () => (await runtime.api("/plugins")).items.find((v) => v.id === id)?.status
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
        data(terminal, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          transcript += text
          if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(() => plain().includes(fullscreen ? "0 running" : "Ask anything"), "terminal session ready", 30_000)

  const calls = runtime.calls.length
  offset = transcript.length
  child.terminal.write("/plugins")
  await poll(
    () => (fullscreen ? /\/plugins\s+Plugins/.test(plain()) : /Browse and manage/.test(plain())),
    "plugins autocomplete",
  )
  child.terminal.write("\r")
  await poll(() => plain().includes("Discover and installed"), "plugins browser")
  await poll(() => plain().includes("terminal-plugin"), "plugin list")
  checks.push("slash-opens-browser", "catalog-list")
  child.terminal.write("d")
  await poll(async () => (await status()) === "downloaded", "download")
  checks.push("download-without-activation")
  await poll(() => plain().includes("downloaded"), "download rendered")
  child.terminal.write("i")
  await poll(() => plain().includes("y confirm"), "trust confirmation")
  child.terminal.write("y")
  await poll(async () => (await status()) === "enabled", "install")
  checks.push("explicit-trust-install")
  await poll(() => plain().includes("enabled"), "enabled rendered")
  child.terminal.write(" ")
  await poll(async () => (await status()) === "disabled", "disable")
  checks.push("disable")
  await poll(() => plain().includes("disabled"), "disabled rendered")
  child.terminal.write("\r")
  await poll(() => plain().includes("skills: hello"), "details inventory")
  checks.push("details")
  child.terminal.write("\x1b[27u")
  child.terminal.write("x")
  await poll(() => plain().includes("Confirm uninstall"), "uninstall confirmation")
  child.terminal.write("y")
  await poll(async () => (await status()) === "available", "uninstall")
  checks.push("uninstall")
  assert.equal(runtime.calls.length, calls)
  checks.push("no-model-call")
  console.log(
    JSON.stringify(
      { mode: fullscreen ? "fullscreen" : "mini", passed: checks.length, checks, output: runtime.output },
      null,
      2,
    ),
  )
} finally {
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "plugins PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  await writeFile(join(runtime.output, "plugins-tui.ansi"), transcript)
  await writeFile(join(runtime.output, "plugins-tui.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
  console.error(`Plugins TUI evidence: ${runtime.output}`)
}
