import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, request } from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "desktop"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const gate = Promise.withResolvers()
const captured = []
const runtime = await startShellFixture(kind === "native" ? "cli" : kind, {
  models: { "grok-4.7": { name: "Side question fixture", tool_call: true, modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 100000, output: 10000 } } },
  async next({ body, text }) { captured.push(body); if (text.includes("SIDE_HOLD")) await gate.promise; return { content: "SIDE_UI_ANSWER" } },
})
const server = createServer((incoming, response) => {
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
const browserSession = `btw-${kind}-${basename(runtime.output)}`
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
    `const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});`,
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
  if (["click", "download"].includes(args[0]) && args[1]?.includes("btw")) await command("scrollintoview", args[1])
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
      "native feedback window",
    )
    await command("wait", "--fn", "!!window.api?.awaitInitialization")
    const connection = JSON.parse(await command("eval", "window.api.awaitInitialization()"))
    runtime.api = async (path, body, method = body ? "POST" : "GET") => {
      const response = await fetch(`${connection.url}${path}?directory=${encodeURIComponent(runtime.directory)}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      assert.ok(response.ok, text)
      return text ? JSON.parse(text) : undefined
    }
  }
  const session = await runtime.api("/session", { title: "Side question UI verification" })
  const endpoint = `/session/${session.id}/side-question`
  const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
  if (kind === "native") {
    await command(
      "eval",
      `(async()=>{ const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(`/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`)});return true})()`,
    )
    await command("reload")
  } else await command("open", url)
  await command("wait", '[data-action="session-btw"]')
  await command("click", '[data-action="session-btw"]')
  await command("wait", '[data-testid="btw-panel"]')
  await command("fill", '[data-testid="btw-question"]', "SIDE_UI_QUESTION")
  await command("click", '[data-testid="btw-ask"]')
  await command("wait", '[data-testid="btw-answer"]')
  assert.match(await command("get", "text", '[data-testid="btw-answer"]'), /SIDE_UI_ANSWER/)
  assert.equal((await runtime.api(endpoint))[0].status, "completed")
  checks.push("composer-entrypoint", "actual-side-model-answer")
  await command("fill", '[data-testid="btw-question"]', "SIDE_HOLD")
  await command("click", '[data-testid="btw-ask"]')
  await command("wait", '[data-testid="btw-cancel"]')
  await command("click", '[data-testid="btw-cancel"]')
  await poll(async () => (await runtime.api(endpoint)).some((entry) => entry.status === "cancelled"), "cancelled side answer")
  assert.equal((await runtime.api(endpoint))[0].status, "completed")
  checks.push("targeted-cancel", "previous-answer-preserved")
  const image = join(runtime.directory, "pixel.png")
  await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==", "base64"))
  await command("upload", '[data-testid="btw-images"]', image)
  await command("fill", '[data-testid="btw-question"]', "SIDE_IMAGE")
  await command("click", '[data-testid="btw-ask"]')
  await poll(async () => (await runtime.api(endpoint)).some((entry) => entry.imageCount === 1 && entry.status === "completed"), "image answer")
  assert.ok(JSON.stringify(captured).includes("image/png"))
  await command("wait", "--fn", 'document.querySelector("[data-testid=btw-images]").value === ""')
  checks.push("image-upload", "image-provider-input", "image-picker-reset-after-ask")
  await command("screenshot", join(runtime.output, "side-answer.png"))
  await command("reload")
  await command("wait", '[data-action="session-btw"]')
  await command("click", '[data-action="session-btw"]')
  await command("wait", '[data-testid="btw-answer"]')
  assert.equal((await runtime.api(endpoint)).length, 3)
  checks.push("reload-restores-answers-without-resubmission")
  await command("press", "Escape")
  await command("fill", '[contenteditable="true"]', "/btw SIDE_SLASH")
  await command("press", "Enter")
  await command("wait", '[data-testid="btw-panel"]')
  await poll(async () => (await runtime.api(endpoint)).some((entry) => entry.question === "SIDE_SLASH" && entry.status === "completed"), "slash side answer")
  assert.deepEqual(await runtime.api(`/session/${session.id}/message`), [])
  checks.push("typed-slash-bypasses-main-transcript")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }))
} finally {
  gate.resolve()
  await command("screenshot", join(runtime.output, "final.png")).catch(() => {})
  await command("close").catch(() => {})
  if (native.child && native.child.exitCode === null) {
    native.child.kill("SIGTERM")
    await deadline(native.exited, 15_000, "owned side-question native exit").catch(async () => {
      native.child.kill("SIGKILL")
      await native.exited
    })
  }
  if (kind === "native") await writeFile(join(runtime.output, "native.log"), Buffer.concat(nativeLogs))
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "side-question-ui.json"), JSON.stringify({ checks, history }, null, 2))
}
