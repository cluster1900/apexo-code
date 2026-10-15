import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, writeFile, realpath } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { loadavg } from "node:os"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const kind = process.argv[2] ?? "cli"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const runtime = await startShellFixture(kind)
const source = join(runtime.output, "catalog")
const entries = ["code-review", "documentation", "browser-tools", "test-runner", "design-system", "project-notes"]
await mkdir(join(source, ".grok-plugin"), { recursive: true })
await writeFile(
  join(source, ".grok-plugin", "marketplace.json"),
  JSON.stringify({
    name: "Test catalog",
    owner: { name: "Apexo QA" },
    plugins: entries.map((name) => ({
      name,
      description: `A working ${name} plugin for Plugins UI verification.`,
      category: "development",
      source: `./plugins/${name}`,
    })),
  }),
)
for (const name of entries) {
  const root = join(source, "plugins", name)
  await mkdir(join(root, "skills", "hello"), { recursive: true })
  await writeFile(join(root, "plugin.json"), JSON.stringify({ name, version: "1.0.0" }))
  await writeFile(
    join(root, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Test skill\n---\nSay hello",
  )
}
await runtime.api("/plugins/manage", { action: "add-source", source })
const session = await runtime.api("/session", { title: "Plugins UI verification" })
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
  const document = request.headers.accept?.includes("text/html")
  if (document || url.pathname.startsWith("/assets/") || /favicon|apple-touch-icon/.test(url.pathname)) {
    const file = Bun.file(join(repo, "packages/app/dist", document ? "index.html" : url.pathname))
    void file.arrayBuffer().then(
      (content) => {
        response.writeHead(200, { "content-type": file.type })
        const bytes = Buffer.from(content)
        if (document && process.argv.includes("--benchmark")) {
          response.end(
            bytes
              .toString()
              .replace(
                "<head>",
                `<head><script>window.__pluginsLongTasks=[];if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>window.__pluginsLongTasks.push(...list.getEntries().map(entry=>entry.toJSON()))).observe({type:'longtask',buffered:true});new MutationObserver((_, observer) => {const element = document.querySelector('[contenteditable="true"]'); if(!element?.getBoundingClientRect().width) return; observer.disconnect(); requestAnimationFrame(()=>{window.__pluginsComposerPerf=performance.now();window.__pluginsComposerPaint=Date.now()-Number(sessionStorage.getItem('plugins-benchmark-start'))});}).observe(document.documentElement,{childList:true,subtree:true});</script>`,
              ),
          )
          return
        }
        response.end(bytes)
      },
      () => {
        response.writeHead(404)
        response.end()
      },
    )
    return
  }
  const target = new URL(runtime.url)
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: target.host },
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
  request.pipe(upstream)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browserSession = `plugins-${kind}-${basename(runtime.output)}`
const history = []
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    [
      "agent-browser",
      "--session",
      browserSession,
      "--executable-path",
      process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ...args,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}

const steps = []
const store = '[data-component="plugins-store"]'
const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
try {
  await command("open", url)
  await command("wait", '[data-action="session-memory"]')
  if (process.argv.includes("--benchmark")) {
    const samples = []
    const diagnostics = []
    for (let i = 0; i < 10; i++) {
      const hostLoadBefore = loadavg()
      await command(
        "eval",
        'window.__pluginsComposerPaint=0;setTimeout(()=>{sessionStorage.setItem("plugins-benchmark-start",String(Date.now()));location.reload()},50);true',
      )
      const elapsed = await poll(async () => {
        const result = await command("eval", "Number(window.__pluginsComposerPaint || 0)")
        return Number(result.trim()) || undefined
      }, "visible composer after navigation")
      samples.push(elapsed)
      diagnostics.push({
        hostLoadBefore,
        hostLoadAfter: loadavg(),
        browser: JSON.parse(
          await command(
            "eval",
            `({paint:window.__pluginsComposerPerf,navigation:performance.getEntriesByType('navigation').map(entry=>entry.toJSON()),longTasks:window.__pluginsLongTasks,resources:performance.getEntriesByType('resource').filter(entry=>entry.startTime<=window.__pluginsComposerPerf).map(entry=>({name:entry.name,start:entry.startTime,duration:entry.duration,bytes:entry.transferSize}))})`,
          ),
        ),
      })
    }
    const sorted = samples.slice(2).sort((a, b) => a - b)
    const benchmark = {
      samples,
      medianMs: (sorted[3] + sorted[4]) / 2,
      p95Ms: sorted[7],
      scope: "browser clock: reload requested to first visible composer animation frame; agent-browser",
    }
    console.log(JSON.stringify(benchmark))
    await writeFile(join(runtime.output, "plugins-benchmark.json"), JSON.stringify(benchmark, null, 2))
    await writeFile(join(runtime.output, "plugins-benchmark-diagnostics.json"), JSON.stringify(diagnostics, null, 2))
  }
  if (!process.argv.includes("--benchmark-only")) {
    await command("press", "Control+Shift+p")
    await command("snapshot", "-i")
    await command("press", "Escape")
    await command("press", "Meta+,")
    await command("wait", '[data-component="tabs-v2"], [data-component="tabs"]')
    await command(
      "wait",
      "--fn",
      `Array.from(document.querySelectorAll('[role="tab"]')).some(tab => tab.textContent.trim() === ${JSON.stringify("Plugins")})`,
    )
    await command("find", "role", "tab", "click", "--name", "Plugins", "--exact")
    await command("wait", store)
    await poll(async () => Number((await command("get", "count", ".plugins-card")).trim()) === 6, "six catalog cards")
    steps.push("open-store", "catalog-grid")
    await command("screenshot", join(runtime.output, "plugins-store.png"))
    if (!process.argv.includes("--sources-only")) {
      await command("fill", ".plugins-filters input", "code-review")
      assert.equal(Number((await command("get", "count", ".plugins-card")).trim()), 1)
      steps.push("search")
      await command("click", ".plugins-card")
      await writeFile(join(source, "plugins", "code-review", "README.md"), "Downloaded plugin instructions")
      await command("find", "role", "button", "click", "--name", "Download", "--exact")
      await poll(
        async () =>
          (await runtime.api("/plugins")).items.find((v) => v.name === "code-review")?.status === "downloaded",
        "download state",
      )
      steps.push("download-without-enable")
      await poll(
        async () =>
          (await command("eval", 'document.querySelector(".plugins-readme")?.textContent ?? ""')).includes(
            "Downloaded plugin instructions",
          ),
        "downloaded README appears without reopening details",
      )
      steps.push("download-refreshes-readme")
      await command("find", "role", "button", "click", "--name", "Install", "--exact")
      await command("wait", '[role="alertdialog"]')
      await command("find", "role", "button", "click", "--name", "Continue", "--exact")
      await poll(
        async () => (await runtime.api("/plugins")).items.find((v) => v.name === "code-review")?.status === "enabled",
        "installed state",
      )
      steps.push("trust-confirmation", "install")
      await writeFile(
        join(source, "plugins", "code-review", "plugin.json"),
        JSON.stringify({ name: "code-review", version: "2.0.0" }),
      )
      await command("find", "role", "button", "click", "--name", "Update", "--exact")
      await command("find", "role", "button", "click", "--name", "Continue", "--exact")
      await poll(
        async () =>
          (await runtime.api("/plugins")).items.find((v) => v.name === "code-review")?.installedVersion === "2.0.0",
        "updated version",
      )
      steps.push("update")
      await command("find", "role", "button", "click", "--name", "Apply to this project", "--exact")
      await command("find", "role", "button", "click", "--name", "Disable", "--exact")
      await poll(
        async () => (await runtime.api("/plugins")).items.find((v) => v.name === "code-review")?.status === "disabled",
        "disabled state",
      )
      steps.push("disable")
      await command("screenshot", join(runtime.output, "plugins-detail.png"))
      await command("find", "role", "button", "click", "--name", "Uninstall", "--exact")
      await command("find", "role", "button", "click", "--name", "Continue", "--exact")
      await poll(
        async () => (await runtime.api("/plugins")).items.find((v) => v.name === "code-review")?.status === "available",
        "uninstalled state",
      )
      steps.push("uninstall")
      await command("find", "role", "button", "click", "--name", "Install your own", "--exact")
      await command("fill", "#plugins-source", join(source, "plugins", "documentation"))
      await command("click", '.plugins-form button[type="submit"]')
      await command("find", "role", "button", "click", "--name", "Continue", "--exact")
      await poll(
        async () =>
          (await runtime.api("/plugins")).items.some((v) => v.name === "documentation" && v.status === "enabled"),
        "manual installation",
      )
      steps.push("manual-local-install")
      await command("find", "role", "button", "click", "--name", "Installed", "--exact")
      await command("fill", ".plugins-filters input", "")
      assert.equal(Number((await command("get", "count", ".plugins-card")).trim()), 1)
      steps.push("installed-filter")
    }
    const extra = join(runtime.output, "extra-catalog")
    await mkdir(join(extra, ".grok-plugin"), { recursive: true })
    await writeFile(
      join(extra, ".grok-plugin", "marketplace.json"),
      JSON.stringify({ name: "Empty source", plugins: [] }),
    )
    await command("find", "role", "button", "click", "--name", "Sources", "--exact")
    await command("find", "role", "button", "click", "--name", "Add source", "--exact")
    await command("fill", "#plugins-source", extra)
    await command("click", '.plugins-form button[type="submit"]')
    const extraPath = await realpath(extra)
    await poll(
      async () => (await runtime.api("/plugins")).sources.some((v) => v.location === extraPath),
      "extra source added",
    )
    await command("scrollintoview", ".plugins-source:last-child button")
    await command("click", ".plugins-source:last-child button")
    await command("snapshot", "-i")
    await command("screenshot", join(runtime.output, "plugins-source-confirm.png"))
    await command("find", "role", "button", "click", "--name", "Continue", "--exact")
    await poll(
      async () => !(await runtime.api("/plugins")).sources.some((v) => v.location === extraPath),
      "extra source removed",
    )
    steps.push("add-source", "remove-source")
    await command("press", "Escape")
    await command("eval", 'localStorage.setItem("apexo.global.dat:language", JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("press", "Meta+,")
    await command(
      "wait",
      "--fn",
      `Array.from(document.querySelectorAll('[role="tab"]')).some(tab => tab.textContent.trim() === ${JSON.stringify("插件")})`,
    )
    await command("find", "role", "tab", "click", "--name", "插件", "--exact")
    await command("wait", store)
    assert.match(await command("get", "text", store), /自行安装/)
    assert.doesNotMatch(await command("get", "text", store), /Marketplace/)
    steps.push("chinese-plugins-labels")
    await command("screenshot", join(runtime.output, "plugins-zh.png"))
    for (const locale of ["zht", "de", "ja", "ar", "hi", "pl", "th", "tr"]) {
      const { dict } = await import(join(repo, "packages/app/src/i18n", `${locale}.ts`))
      await command("press", "Escape")
      await command(
        "eval",
        `localStorage.setItem("apexo.global.dat:language", JSON.stringify({locale:${JSON.stringify(locale)}}))`,
      )
      await command("reload")
      await command("wait", '[data-action="session-memory"]')
      await command("press", "Meta+,")
      await command(
        "wait",
        "--fn",
        `Array.from(document.querySelectorAll('[role="tab"]')).some(tab => tab.textContent.trim() === ${JSON.stringify(dict["plugins.title"])})`,
      )
      await command("find", "role", "tab", "click", "--name", dict["plugins.title"], "--exact")
      await command("wait", store)
      const content = await command("get", "text", store)
      assert.ok(content.includes(dict["plugins.add"]))
      assert.ok(content.includes(dict["plugins.sources"]))
      assert.doesNotMatch(content, /Marketplace/)
      if (locale === "ar") {
        assert.match(await command("eval", "document.documentElement.dir"), /rtl/)
        await command("screenshot", join(runtime.output, "plugins-ar.png"))
      }
      steps.push(`locale-${locale}`)
      console.error(`Verified Plugins UI locale: ${locale}`)
    }
    await command("set", "viewport", "390", "844")
    assert.match(
      await command(
        "eval",
        'document.querySelector(".plugins-store").scrollWidth <= document.querySelector(".plugins-store").clientWidth + 1',
      ),
      /true/,
    )
    await command("screenshot", join(runtime.output, "plugins-mobile.png"))
    steps.push("small-screen-no-overflow")
  }
  console.log(JSON.stringify({ kind, passed: steps.length, steps, output: runtime.output }, null, 2))
} finally {
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "plugins-ui.json"), JSON.stringify({ steps, history }, null, 2))
  console.error(`Plugins UI evidence: ${runtime.output}`)
}
