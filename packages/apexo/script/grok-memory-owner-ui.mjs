import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { poll, deadline } from "./grok-shell-fixture.mjs"
import { createHistoricalMemoryFixture } from "./grok-memory-owner-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const fixture = await createHistoricalMemoryFixture(kind === "native" ? "desktop" : kind)
const runtime = fixture.runtime
const session = fixture.session
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
const browserSession = `memory-owner-${kind}-${basename(runtime.output)}`
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
    `const {app}=require('electron');console.log('Memory fixture initial app path:',app.getAppPath());if(!${JSON.stringify(process.argv.includes("--probe-original"))})app.setAppPath(${JSON.stringify(desktop)});console.log('Memory fixture corrected app path:',app.getAppPath());app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
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
      "Memory native window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    await command("eval", "window.api.awaitInitialization()")
    await command("eval", `window.api.setDefaultServerUrl(${JSON.stringify(runtime.url)})`)
  }
  const browserUrl = `http://127.0.0.1:${server.address().port}`
  const route = `/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
  for (const locale of ["en", "zh", "zht"]) {
    const { dict } = await import(`../../app/src/i18n/${locale}.ts`)
    const expected = dict["memory.work.historicalCaptureOwnership"]
    assert.ok(expected)
    if (kind === "native") {
      await command(
        "eval",
        `window.api.storeSet("apexo.global.dat", "server", JSON.stringify({list:[{type:"http",http:{url:${JSON.stringify(runtime.url)}}}],projects:{},lastProject:{},recentlyClosed:{}}))`,
      )
      await command(
        "eval",
        `window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:${JSON.stringify(locale)}}))`,
      )
      await command(
        "eval",
        `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});localStorage.setItem('apexo.global.dat:language',JSON.stringify({locale:${JSON.stringify(locale)}}));return true})()`,
      )
      await command("reload")
    } else {
      await command("open", `${browserUrl}${route}`)
      await command(
        "eval",
        `localStorage.setItem('apexo.global.dat:language',JSON.stringify({locale:${JSON.stringify(locale)}}))`,
      )
      await command("reload")
    }
    await command("wait", '[data-action="session-memory"]')
    await command("fill", '[contenteditable="true"]', "/flush")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-work"]')
    await poll(
      async () => (await command("get", "text", '[data-component="memory-work"]')).includes(expected),
      "localized historical Memory guidance",
    )
    const operation = await runtime.api(`/experimental/session/${session.id}/memory/operation`)
    assert.deepEqual(operation.result, { status: "conflict", reason: "historical_capture_ownership" })
    assert.equal(fixture.calls.extraction, 0)
    await fixture.preserved()
    await command("screenshot", join(runtime.output, `memory-owner-${locale}.png`))
    checks.push(`${locale}-actionable-guidance`, `${locale}-no-extraction-or-history-mutation`)
    await command("press", "Escape")
  }
  console.log(
    JSON.stringify(
      { kind, checks, extractionCalls: fixture.calls.extraction, syntheticLegacySeed: true, output: runtime.output },
      null,
      2,
    ),
  )
} catch (error) {
  await command("snapshot", "-i").catch(() => {})
  await command("screenshot", join(runtime.output, "failure.png")).catch(() => {})
  throw error
} finally {
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned Memory window exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "memory-owner-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
  console.error(`Memory ownership UI evidence: ${runtime.output}`)
}
