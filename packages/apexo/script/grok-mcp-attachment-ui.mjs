import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

import { startMcpAttachmentFixture } from "./grok-mcp-attachment-fixture.mjs"
const kind = process.argv[2] ?? "desktop"
const fixture = await startMcpAttachmentFixture()
const { runtime, repo } = fixture
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
const browserSession = `native-mcp-${kind}-${basename(runtime.output)}`
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("mcp")) {
    await command("scrollintoview", args[1])
    await command(
      "wait",
      "--fn",
      `(()=>{const target=document.querySelector(${JSON.stringify(args[1])});if(!target||target.disabled)return false;const r=target.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&target.contains(document.elementFromPoint(x,y))})()`,
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
      "native MCP window",
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
  await command("wait", '[data-action="mcp-resources"]')
  assert.equal((await fixture.events()).filter((row) => ["list", "read", "templates"].includes(row.event)).length, 0)
  assert.equal(runtime.calls.length, 0)
  checks.push("passive-composer-zero-catalog-read-model-work")
  const picker = '[data-component="mcp-resource-picker"]'
  await command("click", '[data-action="mcp-resources"]')
  await command("wait", `${picker} [data-action="mcp-resource-attach"]`)
  await command("wait", "--fn", `!document.querySelector('${picker} [data-action="mcp-resources-refresh"]').disabled`)
  assert.ok((await command("get", "text", picker)).includes("Named note"))
  assert.equal(runtime.calls.length, 0)
  checks.push("native-catalog-and-templates-without-model")
  await command("click", `${picker} section:first-of-type [data-action="mcp-resource-attach"]`)
  await command("wait", "--text", "Attached to your draft.")
  await command("wait", "--fn", `!document.querySelector('${picker} [data-action="mcp-resources-refresh"]').disabled`)
  await command("click", `${picker} section:nth-of-type(4) [data-action="mcp-template-select"]`)
  await command("fill", `${picker} input[name="name"]`, "雪 note")
  await command("fill", `${picker} input[name="query"]`, "a&b")
  await command("fill", `${picker} input[name="values"]`, "one two")
  await command("fill", `${picker} input[name="map"]`, "key=value")
  await command("click", `${picker} [data-action="mcp-template-attach"]`)
  await command("wait", "--text", "Attached to your draft.")
  await command("wait", "--fn", `!document.querySelector('${picker} [data-action="mcp-resources-refresh"]').disabled`)
  const reads = (await fixture.events()).filter((row) => row.event === "read").map((row) => row.params.uri)
  assert.ok(reads.includes("fixture://notes/one"))
  assert.ok(reads.some((uri) => uri.includes("%E9%9B%AA%20note") && uri.includes("query=a%26b")))
  checks.push("resource-and-rfc6570-template-canonical-bytes-attached")
  await command("click", `${picker} section:nth-of-type(3) [data-action="mcp-resource-attach"]`)
  await command(
    "wait",
    "--fn",
    `!!document.querySelector('${picker} [role="alert"]') && !document.querySelector('${picker} [data-action="mcp-resources-refresh"]').disabled`,
  )
  assert.equal((await fixture.events()).filter((row) => row.event === "read").length, 3)
  checks.push("unsupported-response-rejects-whole-attachment")
  await command("click", `${picker} section:nth-of-type(2) [data-action="mcp-resource-attach"]`)
  await poll(
    async () => (await fixture.events()).some((row) => row.event === "read" && row.params.uri === "fixture://wait"),
    "held read",
  )
  await command("click", `${picker} [data-action="mcp-resources-cancel"]`)
  await command("wait", "--fn", `!document.querySelector('${picker} [data-action="mcp-resources-refresh"]').disabled`)
  await poll(
    async () => (await fixture.events()).some((row) => row.event === "read-cleanup"),
    "explicit local cancellation",
  )
  assert.equal(runtime.calls.length, 0)
  checks.push("explicit-cancel-joins-local-owner-no-model-work")
  await command("press", "Escape")
  await command("wait", "--fn", "!!document.querySelector('[data-action=\"prompt-submit\"]') && !document.querySelector('[data-action=\"prompt-submit\"]').disabled")
  await command("click", '[data-action="prompt-submit"]')
  await poll(
    () =>
      fixture.delivered.some(
        (row) => !row.ancillary && JSON.stringify(row.input).includes("UNICODE:雪:fixture://notes/one"),
      ),
    "provider receives prepared bytes",
    30000,
  )
  assert.ok(fixture.delivered.some((row) => !row.ancillary && JSON.stringify(row.input).includes("query=a%26b")))
  assert.ok(!fixture.delivered.some((row) => JSON.stringify(row.input).includes("FIRST:")))
  checks.push("draft-submission-delivers-captured-bytes-to-native-provider")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} finally {
  await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned MCP native exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fixture.close()
  await writeFile(join(runtime.output, "native-mcp-ui.json"), JSON.stringify({ checks, history, requests }, null, 2))
}
