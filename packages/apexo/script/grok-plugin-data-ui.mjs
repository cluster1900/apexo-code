import { holdPluginData } from "./grok-plugin-data-fixture.mjs"
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "desktop"
const locale = process.argv.includes("--locale") ? process.argv[process.argv.indexOf("--locale") + 1] : "en"
assert.ok(["en", "zh", "zht"].includes(locale), "Supported probe locales: en, zh, zht")
const dictionary = (await import(`../../app/src/i18n/${locale}.ts`)).dict
const t = (key) => dictionary[key]

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
const requests = []
const server = createServer((incoming, response) => {
  response.on("finish", () => requests.push({ path: incoming.url, status: response.statusCode }))
  const url = new URL(incoming.url, "http://localhost")
  const document = incoming.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    void file.arrayBuffer().then(
      (content) => {
        response.writeHead(200, { "content-type": file.type })
        response.end(Buffer.from(content))
      },
      () => {
        response.writeHead(404)
        response.end()
      },
    )
    return
  }
  const target = new URL(runtime.url)
  const upstream = request(
    {
      hostname: target.hostname,
      port: target.port,
      path: incoming.url,
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
      agent: false,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers)
      reply.pipe(response)
      response.on("close", () => reply.destroy())
    },
  )
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502)
    response.end()
  })
  response.on("close", () => upstream.destroy())
  incoming.pipe(upstream)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browserSession = `native-plugins-${kind}-${basename(runtime.output)}`
const history = []
const native = { child: undefined, exited: undefined, port: undefined }
const nativeLogs = []
if (kind === "native") {
  const appData = join(runtime.output, "native-app-data")
  await mkdir(join(appData, "com.apexolab.desktop.dev"), { recursive: true })
  await writeFile(
    join(appData, "com.apexolab.desktop.dev/apexo.settings"),
    JSON.stringify({ firstLaunchOnboardingComplete: true }),
  )
  const desktop = join(repo, "packages/desktop")
  const wrapper = join(runtime.output, "native.cjs")
  await writeFile(
    wrapper,
    `const {app}=require('electron');console.log('Workflow fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Workflow fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
  )
  const reservation = createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  native.port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  native.child = spawn(
    join(
      desktop,
      "node_modules/electron/dist",
      (await readFile(join(desktop, "node_modules/electron/path.txt"), "utf8")).trim(),
    ),
    [wrapper, `--remote-debugging-port=${native.port}`],
    {
      cwd: runtime.directory,
      env: { ...runtime.env, SHELL: "/bin/sh", APEXO_PORT: "", APEXO_TEST_ONBOARDING: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  native.exited = new Promise((resolve) => native.child.once("exit", resolve))
  native.child.stdout.on("data", (chunk) => nativeLogs.push(chunk))
  native.child.stderr.on("data", (chunk) => nativeLogs.push(chunk))
}
const command = async (...args) => {
  // agent-browser's click interception guard runs before nested-scroll reveal.
  // Scroll the real form to the action, as a user would, before clicking it.
  if (["click", "download"].includes(args[0]) && args[1]?.includes("plugins")) {
    await command("scrollintoview", args[1])
    await command(
      "wait",
      "--fn",
      `(()=>{const target=document.querySelector(${JSON.stringify(args[1])});if(!target)return false;const r=target.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&target.contains(document.elementFromPoint(x,y))})()`,
    )
  }
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      ...(kind === "native"
        ? ["--cdp", String(native.port)]
        : [
            "--executable-path",
            process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]),
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}
const checks = []
try {
  if (kind === "native") {
    await poll(
      () =>
        fetch(`http://127.0.0.1:${native.port}/json/list`)
          .then((response) => response.json())
          .then((tabs) => tabs.some((tab) => tab.type === "page"))
          .catch(() => false),
      "native Plugins window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const connection = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
    await command(
      "eval",
      `window.api.storeSet("apexo.global.dat", "server", JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
    )
  }
  const session = (
    await runtime.api("/api/session", {
      location: { directory: runtime.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const catalog = await runtime.api("/api/plugins/manage", { action: "add-source", source })
  const skill = catalog.items.find((item) => item.name === "native-skill")
  const unsupported = catalog.items.find((item) => item.name === "native-lsp")
  const endpoint = "/api/plugins/runtime"
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/server/${Buffer.from(kind === "native" ? runtime.url : browserUrl).toString("base64url")}/session/${session.id}`
  const url = `${browserUrl}${route}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{ const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
    )
    await command("reload")
  } else await command("open", url)
  await command("wait", '[data-action="session-hooks"]')
  if (locale !== "en") {
    if (kind === "native")
      await command(
        "eval",
        `window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:${JSON.stringify(locale)}}))`,
      )
    await command(
      "eval",
      `localStorage.setItem("apexo.global.dat:language", JSON.stringify({locale:${JSON.stringify(locale)}}))`,
    )
    await command("reload")
    await command("wait", '[data-action="session-hooks"]')
  }
  await command("press", "Meta+,")
  await command("find", "role", "tab", "click", "--name", t("plugins.title"), "--exact")
  await command("wait", '[data-component="plugins-runtime-generation"]')
  assert.equal((await runtime.api(endpoint)).active.length, 0)
  assert.equal(runtime.calls.length, 0)
  checks.push("native-store-and-passive-runtime")
  const button = async (action) => {
    const name = {
      Download: t("plugins.download"),
      Install: t("wsl.onboarding.install"),
      Continue: t("common.continue"),
      Uninstall: t("plugins.uninstall"),
      Refresh: t("wsl.onboarding.refresh"),
    }[action]
    assert.ok(name, `Missing action translation: ${action}`)
    await command(
      "eval",
      `(()=>{const target=[...document.querySelectorAll('.plugins-store button')].find(item=>item.textContent.trim()===${JSON.stringify(name)});if(!target)throw new Error('Plugin action missing');target.scrollIntoView({block:'center'});return true})()`,
    )
    return command("find", "role", "button", "click", "--name", name, "--exact")
  }
  await command("fill", ".plugins-filters input", "native-skill")
  await command("click", ".plugins-card")
  await button("Download")
  await poll(
    async () => (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "downloaded",
    "download",
  )
  await command("wait", ".plugins-readme")
  assert.match(await command("get", "text", ".plugins-readme"), /About native-skill/)
  checks.push("download-and-detail")
  await button("Install")
  await button("Continue")
  await poll(
    async () => (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "enabled",
    "install",
  )
  assert.ok(
    (await command("get", "text", '[data-component="plugins-activation-status"]')).includes(
      t("plugins.activation.inactive"),
    ),
  )
  checks.push("enabled-is-not-active")
  const releaseReader = await holdPluginData(runtime)
  try {
    await button("Uninstall")
    await button("Continue")
    await poll(
      async () => (await command("get", "text", ".plugins-store")).includes(t("plugins.cleanupDeferred")),
      "reader-backed cleanup notice",
    )
  } finally {
    await releaseReader()
  }
  assert.equal((await runtime.api("/api/plugins")).retainedData, undefined)
  await button("Refresh")
  await poll(
    async () => !(await command("get", "text", ".plugins-store")).includes(t("plugins.cleanupDeferred")),
    "omitted retainedData clears Desktop notice",
  )
  checks.push("catalog-omission-clears-previously-visible-cleanup-notice")
  await button("Install")
  await button("Continue")
  await poll(
    async () => (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "enabled",
    "reinstalled before activation",
  )

  await command("click", '[data-action="plugins-runtime-reload"]')
  await poll(
    async () =>
      (await command("get", "text", '[data-component="plugins-activation-status"]')).includes(
        t("plugins.activation.active"),
      ),
    "native activation",
  )
  const active = await runtime.api(endpoint)
  assert.deepEqual(active.active, [skill.id])
  await command("screenshot", join(runtime.output, "plugins-active.png"))
  checks.push("explicit-native-activation")
  await button("Uninstall")
  await command("wait", '.plugins-confirm input[type="checkbox"]')
  assert.ok((await command("get", "text", ".plugins-confirm")).includes(t("plugins.keepData")))
  await command("click", '.plugins-confirm input[type="checkbox"]')
  assert.equal(
    JSON.parse(await command("eval", `document.querySelector('.plugins-confirm input[type="checkbox"]').checked`)),
    true,
  )
  await button("Continue")
  await poll(
    async () => (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "available",
    "keep-data uninstall",
  )
  assert.equal((await runtime.api("/api/plugins")).retainedData, undefined)
  checks.push("desktop-keep-data-checkbox-reaches-native-action")
  await button("Install")
  await button("Continue")
  await poll(
    async () => (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "enabled",
    "reinstall",
  )
  const previous = (await runtime.api(endpoint)).generation
  await command("click", '[data-action="plugins-runtime-reload"]')
  await poll(async () => (await runtime.api(endpoint)).generation > previous, "reinstallation applied")
  await button("Uninstall")
  await command("wait", '.plugins-confirm input[type="checkbox"]')
  assert.equal(
    JSON.parse(await command("eval", `document.querySelector('.plugins-confirm input[type="checkbox"]').checked`)),
    false,
  )
  await button("Continue")
  await poll(
    async () => (await command("get", "text", ".plugins-store")).includes(t("plugins.cleanupDeferred")),
    "deferred cleanup visible",
  )
  assert.deepEqual((await runtime.api("/api/plugins")).retainedData, [{ id: skill.id, reason: "readers" }])
  await command("screenshot", join(runtime.output, "plugins-data-retained.png"))
  checks.push("desktop-default-uninstall-shows-deferred-cleanup")
  assert.equal(runtime.calls.length, 0)
  checks.push("no-model-work")
  console.log(JSON.stringify({ kind, locale, passed: checks.length, checks, output: runtime.output }))
} finally {
  await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned Plugins native exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  state.nativeChild?.kill("SIGTERM")
  await deadline(state.nativeExited, 10000, "native server cleanup").catch(() => state.nativeChild?.kill("SIGKILL"))
  await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(serverLogs))
  await runtime.close()
  await writeFile(
    join(runtime.output, "native-plugins-ui.json"),
    JSON.stringify({ checks, history, requests }, null, 2),
  )
}
