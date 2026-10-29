import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createServer } from "node:http"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const { chromium } = createRequire(join(repo, "packages/app/package.json"))("@playwright/test")
const kind = process.argv[2] ?? "cli"

const pageServer = createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404)
    response.end()
    return
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  response.end(`<!doctype html><title>Browser fixture</title><label>Name <input id="name"></label><button id="go" onclick="document.querySelector('#out').textContent='clicked:'+document.querySelector('#name').value">Go</button><div id="out">Idle</div>`)
})
await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve))
const pageURL = `http://127.0.0.1:${pageServer.address().port}/`

const cdpReservation = createServer()
await new Promise((resolve) => cdpReservation.listen(0, "127.0.0.1", resolve))
const cdpPort = cdpReservation.address().port
await new Promise((resolve) => cdpReservation.close(resolve))

const runtime = await startShellFixture(kind, {
  config: { permission: { "*": "allow" } },
})
let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    args: [`--remote-debugging-port=${cdpPort}`],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(pageURL)

  const session = (await runtime.api("/api/session", {
    model: { providerID: "xai", id: "grok-4.7" },
    location: { directory: runtime.directory },
  })).data
  assert.ok(session?.id, "v2 session created")

  if (kind === "cli") {
    const cli = Bun.spawn(
      ["bun", join(repo, "packages/cli/src/index.ts"), "api", "GET", `/api/session?directory=${encodeURIComponent(runtime.directory)}`],
      { cwd: join(repo, "packages/cli"), env: runtime.env, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exitCode] = await Promise.all([cli.stdout.text(), cli.stderr.text(), cli.exited])
    assert.equal(exitCode, 0, stderr)
    assert.ok(Array.isArray(JSON.parse(stdout).data), stdout)
  }

  const opened = await runtime.api(`/api/session/${session.id}/browser`, {
    url: pageURL,
    cdpUrl: `http://127.0.0.1:${cdpPort}`,
  })
  assert.equal(opened.status, "connected")
  assert.equal(opened.page.url, pageURL)

  const observed = await runtime.api(`/api/session/${session.id}/browser/${opened.id}/action`, {
    action: "observe",
    pageID: opened.page.id,
    expectedSnapshotHash: opened.page.snapshotHash,
  })
  assert.match(observed.output, /Browser fixture/)

  await runtime.api(`/api/session/${session.id}/browser/${opened.id}/action`, {
    action: "type",
    pageID: observed.page.id,
    expectedSnapshotHash: observed.page.snapshotHash,
    selector: "#name",
    text: "Apexo",
  })
  const clicked = await runtime.api(`/api/session/${session.id}/browser/${opened.id}/action`, {
    action: "click",
    pageID: observed.page.id,
    selector: "#go",
  })
  assert.match(clicked.output, /clicked:Apexo/)

  const screenshot = await runtime.api(`/api/session/${session.id}/browser/${opened.id}/action`, {
    action: "screenshot",
    pageID: clicked.page.id,
    expectedSnapshotHash: clicked.page.snapshotHash,
    fullPage: true,
  })
  assert.equal(screenshot.artifact.mime, "image/png")
  assert.ok(screenshot.artifactData?.length > 100)

  const replay = await runtime.api(`/api/session/${session.id}/browser/${opened.id}/events`)
  assert.ok(replay.events.length >= 6)
  assert.ok(replay.cursor.head >= replay.events.at(-1).durable.seq)

  await runtime.api(`/api/session/${session.id}/browser/${opened.id}/close`, undefined, "POST")
  console.log(JSON.stringify({ sessionID: session.id, browserSessionID: opened.id, events: replay.events.length, artifact: screenshot.artifact.relativePath }))
} finally {
  await browser?.close()
  await runtime.close()
  pageServer.closeAllConnections()
  await new Promise((resolve) => pageServer.close(resolve))
}
