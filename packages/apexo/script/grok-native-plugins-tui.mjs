import { Terminal } from "@xterm/headless"
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "desktop"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const state = { nativeChild: undefined, nativeExited: undefined }
const runtime = await startShellFixture("cli", { next: () => ({ content: "PLUGIN_UI_DONE" }) })
const source = join(runtime.output, "catalog")
for (const name of ["native-skill", "native-lsp"]) {
  const root = join(source, "plugins", name)
  await mkdir(join(root, "skills", "hello"), { recursive: true })
  await writeFile(join(root, "plugin.json"), JSON.stringify({ name, version: "1.0.0" }))
  await writeFile(join(root, "README.md"), `About ${name}`)
  await writeFile(join(root, "skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: Test skill\n---\nHello")
  if (name === "native-lsp")
    await writeFile(
      join(root, ".lsp.json"),
      JSON.stringify({
        lspServers: {
          local: { command: "unused-native-fixture", transport: "tcp", extensionToLanguage: { ".fixture": "fixture" } },
        },
      }),
    )
}
await mkdir(join(source, ".grok-plugin"))
await writeFile(
  join(source, ".grok-plugin", "marketplace.json"),
  JSON.stringify({
    name: "Native UI catalog",
    plugins: ["native-skill", "native-lsp"].map((name) => ({
      name,
      source: `./plugins/${name}`,
      description: `Native ${name} acceptance`,
    })),
  }),
)
await runtime.crash()
await writeFile(
  join(runtime.directory, "apexo.json"),
  JSON.stringify({
    ...JSON.parse(runtime.env.APEXO_CONFIG_CONTENT),
    snapshots: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers: {
      xai: {
        name: "Native UI fixture",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: runtime.env.XAI_BASE_URL,
          settings: { apiKey: "local-parity-key" },
        },
        models: {
          "grok-4.7": {
            name: "Native UI fixture",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  }),
)
const nativeServerFile = join(runtime.output, "native-server.mjs")
await writeFile(
  nativeServerFile,
  `import { webHandler } from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:app.handler});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
)
state.nativeChild = spawn(process.execPath, [nativeServerFile], {
  cwd: runtime.directory,
  env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
})
state.nativeExited = new Promise((resolve) => state.nativeChild.once("exit", resolve))
const serverLogs = []
state.nativeChild.stdout.on("data", (chunk) => {
  serverLogs.push(chunk)
  const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
  if (match) runtime.url = match[1]
})
state.nativeChild.stderr.on("data", (chunk) => serverLogs.push(chunk))
const oldUrl = runtime.url
await poll(() => runtime.url !== oldUrl, "native-only server ready", 30000)
runtime.api = async (path, body, method = body ? "POST" : "GET") => {
  const response = await fetch(`${runtime.url}${path}?location[directory]=${encodeURIComponent(runtime.directory)}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  assert.ok(response.ok, text)
  return text ? JSON.parse(text) : undefined
}
assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
assert.deepEqual(await runtime.api("/api/health"), { healthy: true })
const fullscreen = process.argv.includes("--fullscreen")
const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
const screen = { text: "" }
const plain = () =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  ).join("\n")
const checks = []
let child
try {
  const catalog = await runtime.api("/api/plugins/manage", { action: "add-source", source })
  const skill = catalog.items.find((item) => item.name === "native-skill")
  const unsupported = catalog.items.find((item) => item.name === "native-lsp")
  await symlink(join(repo, "packages/apexo/node_modules"), join(runtime.output, "node_modules"))
  const harness = join(runtime.output, "plugins-terminal.tsx")
  await writeFile(
    harness,
    `/** @jsxImportSource @opentui/solid */
import { createCliRenderer } from ${JSON.stringify(import.meta.resolve("@opentui/core"))};
import { render } from ${JSON.stringify(import.meta.resolve("@opentui/solid"))};
import { createDefaultOpenTuiKeymap } from ${JSON.stringify(import.meta.resolve("@opentui/keymap/opentui"))};
import { KeymapProvider } from ${JSON.stringify(import.meta.resolve("@opentui/keymap/solid"))};
import { createApexoClient } from ${JSON.stringify(import.meta.resolve("@apexo/sdk/v2"))};
import { PluginsBrowser, pluginsActions } from ${JSON.stringify(join(repo, "packages/tui/src/component/plugins-browser.tsx"))};
const renderer = await createCliRenderer({exitOnCtrlC:true, useKittyKeyboard:{}, useMouse:false});
const keymap = createDefaultOpenTuiKeymap(renderer);
const client = createApexoClient({baseUrl:${JSON.stringify(runtime.url)}});
await render(() => <KeymapProvider keymap={keymap}><PluginsBrowser height={${fullscreen ? 32 : 21}} actions={pluginsActions(client, ${JSON.stringify(runtime.directory)})} theme={() => ({text:"#ffffff",muted:"#aaaaaa",error:"#ff5555",highlight:"#55ffff"})} onClose={() => {renderer.destroy();process.exit(0)}} /></KeymapProvider>, renderer);
`,
  )
  const decoder = new TextDecoder()
  child = Bun.spawn(
    [process.execPath, "--no-install", "--preload", import.meta.resolve("@opentui/solid/preload"), harness],
    {
      env: { ...runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: 120,
        rows: 40,
        data(_, bytes) {
          const text = decoder.decode(bytes, { stream: true })
          screen.text += text
          terminal.write(text)
          if (text.includes("\x1b[6n")) child.terminal.write("\x1b[1;1R")
        },
      },
    },
  )
  await poll(
    () => plain().includes("Project snapshot") && plain().includes("native-skill"),
    "native Plugins panel",
    30000,
  )
  checks.push("passive-native-list-and-runtime")
  child.terminal.write("/native-skill\r")
  await poll(() => !plain().includes("native-lsp") && plain().includes("native-skill"), "filtered skill")
  child.terminal.write("i")
  await poll(() => plain().includes("y confirm"), "trust review")
  child.terminal.write("y")
  await poll(() => plain().includes("[enabled] [not active]"), "enabled is not active")
  checks.push("enabled-versus-active")
  await poll(() => !plain().includes("Working…"), "previous Plugins action settled")
  child.terminal.write("l")
  await poll(() => plain().includes("[enabled] [active]"), "explicit activation")
  const active = await runtime.api("/api/plugins/runtime")
  assert.deepEqual(active.active, [skill.id])
  checks.push("explicit-native-activation")
  await runtime.api("/api/plugins/manage", { action: "install", id: unsupported.id, trust: true })
  await poll(() => !plain().includes("Working…"), "previous Plugins action settled")
  child.terminal.write("l")
  await poll(() => plain().includes("Activation unsupported") && plain().includes("lsp"), "typed capability failure")
  const failure = await runtime.api("/api/plugins/runtime")
  assert.deepEqual(failure.active, active.active)
  assert.equal(failure.generation, active.generation)
  assert.ok(plain().includes("[enabled] [active]"))
  checks.push("failure-preserves-active-snapshot")
  await runtime.api("/api/plugins/manage", { action: "disable", id: unsupported.id })
  await poll(() => !plain().includes("Working…"), "previous Plugins action settled")
  child.terminal.write("l")
  await poll(
    () =>
      !plain().includes("Activation unsupported") &&
      !plain().includes("Plugins were not applied") &&
      plain().includes("[enabled] [active]"),
    "successful recovery clears failure",
  )
  assert.equal((await runtime.api("/api/plugins/runtime")).failure, undefined)
  checks.push("successful-recovery-clears-failure")
  assert.equal(runtime.calls.length, 0)
  checks.push("no-model-work")
  console.log(
    JSON.stringify({
      mode: fullscreen ? "expanded-native-actions" : "compact-native-actions",
      checks,
      passed: checks.length,
      output: runtime.output,
    }),
  )
} finally {
  await writeFile(join(runtime.output, "plugins-tui.txt"), plain())
  await writeFile(join(runtime.output, "plugins-tui.ansi"), screen.text)
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "owned Plugins PTY cleanup").catch(() => child.kill("SIGKILL"))
  child?.terminal?.close()
  terminal.dispose()
  state.nativeChild?.kill("SIGTERM")
  await deadline(state.nativeExited, 10000, "native server cleanup").catch(() => state.nativeChild?.kill("SIGKILL"))
  await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(serverLogs))
  await runtime.close()
}
