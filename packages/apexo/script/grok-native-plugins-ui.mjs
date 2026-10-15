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
  await command("press", "Meta+,")
  await command("find", "role", "tab", "click", "--name", "Plugins", "--exact")
  await command("wait", '[data-component="plugins-runtime-generation"]')
  assert.equal((await runtime.api(endpoint)).active.length, 0)
  assert.equal(runtime.calls.length, 0)
  checks.push("native-store-and-passive-runtime")
  const button = async (name) => {
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
  assert.match(
    await command("get", "text", '[data-component="plugins-activation-status"]'),
    /Not active in this project/,
  )
  checks.push("enabled-is-not-active")
  await command("click", '[data-action="plugins-runtime-reload"]')
  await poll(
    async () =>
      (await command("get", "text", '[data-component="plugins-activation-status"]')).includes("Active in this project"),
    "native activation",
  )
  const active = await runtime.api(endpoint)
  assert.deepEqual(active.active, [skill.id])
  await command("screenshot", join(runtime.output, "plugins-active.png"))
  checks.push("explicit-native-activation")
  await runtime.api("/api/plugins/manage", { action: "install", id: unsupported.id, trust: true })
  await command("click", '[data-action="plugins-runtime-reload"]')
  await command("wait", '[data-component="plugins-runtime-failure"]')
  assert.match(await command("get", "text", '[data-component="plugins-runtime-failure"]'), /not supported[\s\S]*lsp/)
  const failure = await runtime.api(endpoint)
  assert.equal(failure.generation, active.generation)
  assert.deepEqual(failure.active, active.active)
  assert.equal(failure.failure.code, "unsupported")
  assert.equal(runtime.calls.length, 0)
  checks.push("unsupported-failure-preserves-active-snapshot", "no-model-work")
  await command("screenshot", join(runtime.output, "plugins-unsupported.png"))
  const locales = process.argv.includes("--activation-locales")
    ? [
        "ar",
        "az",
        "bg",
        "bn",
        "br",
        "bs",
        "ca",
        "cs",
        "da",
        "de",
        "el",
        "es",
        "et",
        "fa",
        "fi",
        "fr",
        "hi",
        "hr",
        "hu",
        "hy",
        "id",
        "is",
        "it",
        "ja",
        "ka",
        "km",
        "ko",
        "lo",
        "lt",
        "lv",
        "mk",
        "mn",
        "ms",
        "my",
        "ne",
        "nl",
        "no",
        "pa",
        "pl",
        "ro",
        "ru",
        "si",
        "sk",
        "sl",
        "sq",
        "sr",
        "sv",
        "tg",
        "th",
        "tr",
        "uk",
        "ur",
        "uz",
        "vi",
      ]
    : process.argv.includes("--five-locales")
      ? ["fo", "dv", "tk", "am", "dz"]
      : process.argv.includes("--locales")
        ? ["zh", "zht"]
        : []
  for (const locale of locales) {
    const dictionary = (await import(`../../app/src/i18n/${locale}.ts`)).dict
    const phrase = (key) => dictionary[`plugins.${key}`]
    if (process.argv.includes("--five-locales")) {
      await runtime.api("/api/plugins/manage", { action: "uninstall", id: skill.id })
      await runtime.api("/api/plugins/manage", { action: "enable", id: unsupported.id })
      // Keep a real unsupported activation failure visible in every translated storefront.
      await fetch(`${runtime.url}/api/plugins/reload?location[directory]=${encodeURIComponent(runtime.directory)}`, {
        method: "POST",
      })
    }
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
    await command("press", "Meta+,")
    await command("find", "role", "tab", "click", "--name", phrase("title"), "--exact")
    await command("wait", '[data-component="plugins-runtime-failure"]')
    assert.ok(
      (await command("get", "text", '[data-component="plugins-runtime-failure"]')).includes(
        phrase("activation.failure.unsupported"),
      ),
    )
    const layout = JSON.parse(
      await command(
        "eval",
        `({dir:document.documentElement.dir,overflow:document.documentElement.scrollWidth>innerWidth+1})`,
      ),
    )
    assert.equal(layout.dir, ["ar", "ur", "fa", "dv"].includes(locale) ? "rtl" : "ltr")
    assert.equal(layout.overflow, false)
    assert.ok((await command("get", "text", ".plugins-header")).includes(phrase("description")))
    assert.ok((await command("get", "text", '[data-action="plugins-runtime-reload"]')).includes(phrase("reload")))
    if (process.argv.includes("--activation-locales")) {
      const panel = await command("get", "text", '[data-component="plugins-runtime"]')
      assert.ok(panel.includes(phrase("activation.title")), `${locale} activation title`)
      assert.ok(panel.includes(phrase("activation.hint")), `${locale} activation hint`)
      assert.ok(
        panel.includes(phrase("activation.generation").replace("{{generation}}", String(active.generation))),
        `${locale} snapshot interpolation`,
      )
      const storefront = await command("get", "text", ".plugins-store")
      assert.ok(storefront.includes(phrase("activation.active")), `${locale} active state`)
      assert.ok(storefront.includes(phrase("activation.inactive")), `${locale} inactive state`)
      const prose = JSON.parse(
        await command(
          "eval",
          `getComputedStyle(document.querySelector('[data-component="plugins-runtime"] p')).direction`,
        ),
      )
      assert.equal(prose, ["ar", "ur", "fa", "dv"].includes(locale) ? "rtl" : "ltr")
      checks.push(`${locale}-activation-copy-direction-interpolation`)
    }
    await command("screenshot", join(runtime.output, `plugins-${locale}.png`))
    if (!process.argv.includes("--five-locales")) continue
    await button(phrase("add"))
    assert.equal(
      JSON.parse(await command("eval", `document.querySelector('.plugins-form input').placeholder`)),
      phrase("sourcePlaceholder"),
    )
    assert.ok((await command("get", "text", ".plugins-form")).includes(phrase("sourceInput")))
    assert.equal(
      JSON.parse(await command("eval", "getComputedStyle(document.querySelector('.plugins-form input')).direction")),
      "ltr",
    )
    await command("screenshot", join(runtime.output, `plugins-${locale}-source.png`))
    await button(phrase("discover"))
    await command("fill", ".plugins-filters input", "native-skill")
    await command("click", ".plugins-card")
    await button(phrase("download"))
    await poll(
      async () =>
        (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "downloaded",
      `${locale} download`,
    )
    await command("wait", ".plugins-readme")
    await button(dictionary["wsl.onboarding.install"])
    await command("wait", ".plugins-confirm")
    assert.ok((await command("get", "text", ".plugins-confirm")).includes(phrase("trust")))
    const identifier = JSON.parse(
      await command(
        "eval",
        `(()=>{const code=document.querySelector('.plugins-confirm code');const prose=code.previousElementSibling;const range=document.createRange();range.setStart(code.firstChild,0);range.setEnd(code.firstChild,1);return {direction:getComputedStyle(code).direction,bidi:getComputedStyle(code).unicodeBidi,prose:getComputedStyle(prose).direction,first:code.textContent[0],slash:range.getBoundingClientRect().x,bounds:code.getBoundingClientRect().toJSON()}})()`,
      ),
    )
    assert.equal(identifier.direction, "ltr")
    assert.equal(identifier.bidi, "isolate")
    assert.equal(identifier.prose, ["ar", "ur", "fa", "dv"].includes(locale) ? "rtl" : "ltr")
    assert.equal(identifier.first, "/")
    assert.ok(
      Math.abs(identifier.slash - identifier.bounds.left) < 1,
      `${locale} leading slash stays at the identifier start`,
    )
    await command("screenshot", join(runtime.output, `plugins-${locale}-trust.png`))
    await command("click", ".plugins-confirm .plugins-actions button:last-child")
    await poll(
      async () => (await runtime.api("/api/plugins")).items.find((item) => item.id === skill.id)?.status === "enabled",
      `${locale} install`,
    )
    await runtime.api("/api/plugins/manage", { action: "disable", id: unsupported.id })
    await command("click", '[data-action="plugins-runtime-reload"]')
    await poll(
      async () => Number((await command("get", "count", '[data-component="plugins-runtime-failure"]')).trim()) === 0,
      `${locale} recovery`,
    )
    assert.ok(
      (await command("get", "text", '[data-component="plugins-activation-status"]')).includes(
        phrase("activation.active"),
      ),
    )
    await button(phrase("uninstall"))
    await command("wait", ".plugins-confirm")
    assert.ok((await command("get", "text", ".plugins-confirm")).includes(phrase("removeNotice")))
    await command("screenshot", join(runtime.output, `plugins-${locale}-removal.png`))
    await command("click", ".plugins-confirm .plugins-actions button:first-child")
    checks.push(`${locale}-storefront-download-install-trust-apply-error-removal`)
  }
  if (locales.length) checks.push("localized-activation-failures")
  // The locale reloads retain the same failed snapshot; recovering must remove its optional failure field.
  await runtime.api("/api/plugins/manage", { action: "disable", id: unsupported.id })
  await command("click", '[data-action="plugins-runtime-reload"]')
  await poll(
    async () => Number((await command("get", "count", '[data-component="plugins-runtime-failure"]')).trim()) === 0,
    "successful recovery clears failure",
  )
  assert.equal((await runtime.api(endpoint)).failure, undefined)
  checks.push("successful-recovery-clears-failure")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
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
