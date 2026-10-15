// Actual Electron window, preload and sidecar, with isolated preferences and storage.
import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const scan = process.argv.includes("--scan")
const manifest = process.argv.includes("--manifest") || scan
const dream = process.argv.includes("--dream")
const captureStatus = process.argv.includes("--capture-status")
const planned = { hold: undefined }
const dreamCalls = []
const captureCalls = []
const runtime = await startShellFixture("cli", {
  config: {
    memory_v2: {
      enabled: true,
      compact_index_enabled: manifest,
      capture_enabled: captureStatus,
      capture_status_enabled: captureStatus,
      automatic_dream_enabled: false,
    },
  },
  async next({ input }) {
    if (captureStatus && JSON.stringify(input).includes("You extract durable memory observations")) {
      captureCalls.push(input)
      if (planned.hold) await planned.hold.promise
      return {
        content: JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "NATIVE_CAPTURE_FACT",
              body: "NATIVE_CAPTURE_DETAIL",
              topic_hint: "native",
              keywords: [],
              aliases: [],
            },
          ],
        }),
      }
    }
    if (dream && JSON.stringify(input).includes("Consolidate durable memory observations into topic Markdown")) {
      const message = input.findLast((row) => row.role === "user").content
      const value = JSON.parse(typeof message === "string" ? message : message.map((part) => part.text ?? "").join(""))
      dreamCalls.push(value)
      if (planned.hold) await planned.hold.promise
      return {
        content: JSON.stringify({
          operations: ["database", "testing"].map((name) => ({
            action: "create",
            path: `topics/${name}.md`,
            content: `# ${name}\nNATIVE_DREAM_SAVED`,
            evidence: value.observations.map((row) => row.path),
          })),
        }),
      }
    }
    if (JSON.stringify(input).includes("You are a memory note formatter"))
      return { content: "## Preferences\nNATIVE_REWRITTEN" }
    return { content: "NATIVE_MEMORY_ACK" }
  },
})
const repo = resolve("../..")
const history = [],
  checks = [],
  logs = []
let child, port
const name = `memory-native-${Date.now()}`
const command = async (...args) => {
  const result = await promisify(execFile)(
    "bunx",
    ["agent-browser", "--session", name, "--cdp", String(port), ...args],
    { timeout: 45000, maxBuffer: 4000000 },
  )
  history.push({ args, output: result.stdout })
  return result.stdout
}
const button = (name) => command("find", "role", "button", "click", "--name", name, "--exact")
try {
  const documents = join(runtime.output, "documents")
  await mkdir(documents)
  const bootstrap = join(runtime.output, "native-bootstrap.mjs")
  await writeFile(
    bootstrap,
    `import { app } from "electron"; app.setPath("documents", ${JSON.stringify(documents)}); await import(${JSON.stringify(pathToFileURL(join(repo, "packages/desktop/out/main/index.js")).href)});`,
  )
  const executable = join(
    repo,
    "packages/desktop/node_modules/electron/dist",
    (await readFile(join(repo, "packages/desktop/node_modules/electron/path.txt"), "utf8")).trim(),
  )
  child = Bun.spawn([executable, "--remote-debugging-port=0", bootstrap], {
    env: {
      ...runtime.env,
      HOME: runtime.env.APEXO_TEST_HOME,
      APEXO_TEST_ONBOARDING: "1",
      APEXO_SIDECAR_V2: "0",
      ELECTRON_RUN_AS_NODE: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const collect = async (stream) => {
    for await (const bytes of stream) {
      const text = new TextDecoder().decode(bytes)
      logs.push(text)
      const match = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)
      if (match) port = Number(match[1])
    }
  }
  void Promise.all([collect(child.stdout), collect(child.stderr)])
  await poll(() => port, "native debug endpoint", 30000)
  await poll(
    async () =>
      (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).some(
        (t) => t.type === "page" && t.url.includes("index.html"),
      ),
    "native window",
    30000,
  )
  await command("wait", "body")
  const seed = await command(
    "eval",
    `window.api.awaitInitialization().then(async server => {
    const dir = ${JSON.stringify(runtime.directory)};
    const api = async (route, body) => { const response = await fetch(server.url+route+'?directory='+encodeURIComponent(dir), {method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Basic '+btoa(server.username+':'+server.password)},...(body?{body:JSON.stringify(body)}:{})}); if(!response.ok) throw new Error(await response.text()); return response.json(); };
    const session = await api('/session', {title:'Native Memory V2'});
    const note = await api('/experimental/session/'+session.id+'/memory/remember', {content:'# Native NATIVE_SEEDED_MEMORY',scope:'workspace'});
    if(!note.path.includes('/memory-v2/')) throw new Error('Native sidecar did not select Memory V2');
    localStorage.setItem('apexo.desktop.window.'+await window.api.getWindowID()+'.last-active-url', '/'+btoa(dir).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')+'/session/'+session.id);
    return { id: session.id, path: note.path };
  })`,
  )
  await command("reload")
  await command("wait", '[data-action="session-memory"]')
  if (manifest) {
    const root = dirname(dirname(dirname(JSON.parse(seed).path)))
    const count = scan ? 10001 : 200
    for (let start = 0; start < count; start += 128)
      await Promise.all(
        Array.from({ length: Math.min(128, count - start) }, (_, offset) =>
          writeFile(
            join(root, "topics", `topic-${String(start + offset).padStart(5, "0")}.md`),
            `# Native topic ${start + offset}\nNATIVE_DESCRIPTION_NOT_IN_COMPACT`,
          ),
        ),
      )
    const before = runtime.calls.length
    await command("fill", '[contenteditable="true"]', "Inspect the saved memory index.")
    await command("press", "Enter")
    const contextStart = performance.now()
    await poll(() => runtime.calls.length > before, "native compact context")
    if (scan) console.error(`Native 10001-topic context ready in ${Math.round(performance.now() - contextStart)}ms after submit`)
    await poll(
      async () => (await readFile(join(root, "MEMORY.md"), "utf8")).includes("## More topics"),
      "native manifest persisted",
    )
    const disk = await readFile(join(root, "MEMORY.md"), "utf8")
    assert.ok(Buffer.byteLength(disk) <= 8192)
    assert.doesNotMatch(disk, /NATIVE_DESCRIPTION_NOT_IN_COMPACT|NATIVE_SEEDED_MEMORY/)
    await command("click", '[data-action="session-memory"]')
    await command("wait", '[data-component="memory-browser"]')
    await command("wait", '[data-memory-path$="/MEMORY.md"]')
    if (scan) {
      assert.equal(Number((await command("get", "count", "[data-memory-path]")).trim()), 10000)
      checks.push("native-10000-file-cap")
    }
    await command("click", '[data-memory-path$="/MEMORY.md"]')
    await command("wait", '[data-component="memory-preview"]')
    await poll(
      async () => (await command("get", "text", '[data-component="memory-preview"]')).includes("More topics"),
      "native compact index preview",
    )
    assert.match(await command("get", "text", '[data-component="memory-preview"]'), /Native topic 0/)
    assert.equal(Number((await command("get", "count", '[data-action="memory-delete"]')).trim()), 0)
    assert.equal(
      (
        await command(
          "eval",
          `(() => { const dialog = document.querySelector('[data-slot="dialog-content"]').getBoundingClientRect(); const mode = document.querySelector('[data-component="memory-mode"]').getBoundingClientRect(); const preview = document.querySelector('[data-component="memory-preview"]').getBoundingClientRect(); return mode.top >= dialog.top && preview.top >= mode.bottom && preview.bottom <= dialog.bottom; })()`,
        )
      ).trim(),
      "true",
    )
    checks.push(
      "native-controls-remain-visible",
      "native-compact-context",
      "native-byte-budget",
      "native-index-preview",
      "generated-index-protected",
    )
    await command("press", "Escape")
    await command("eval", 'window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("click", '[data-action="session-memory"]')
    await command("wait", '[data-memory-path$="/MEMORY.md"]')
    await command("click", '[data-memory-path$="/MEMORY.md"]')
    await command("wait", '[data-component="memory-preview"]')
    await poll(
      async () => (await command("get", "text", '[data-component="memory-preview"]')).includes("More topics"),
      "Chinese window compact preview",
    )
    await command("screenshot", join(runtime.output, "memory-v2-native-manifest-zh.png"))
    checks.push("native-chinese-index-preview")
  } else if (captureStatus) {
    planned.hold = Promise.withResolvers()
    await command("fill", '[contenteditable="true"]', "Remember native capture diagnostic conventions.")
    await command("press", "Enter")
    await poll(() => captureCalls.length === 1, "native capture starts", 30_000)
    await poll(
      async () => /Running/.test(await command("get", "text", '[data-action="memory-capture-notifications"]')),
      "native capture running",
    )
    checks.push("native-capture-running")
    planned.hold.resolve()
    planned.hold = undefined
    await poll(
      async () => /Completed/.test(await command("get", "text", '[data-action="memory-capture-notifications"]')),
      "native capture completes",
    )
    await command("click", '[data-action="memory-capture-notifications"]')
    await command("wait", '[data-component="memory-capture-notifications"]')
    const details = await command("get", "text", '[data-component="memory-capture-notifications"]')
    assert.match(details, /NATIVE_CAPTURE_FACT/)
    assert.match(details, /NATIVE_CAPTURE_DETAIL/)
    assert.match(details, /memory-v2\/apexo\/workspaces/)
    checks.push("native-capture-completion-body-path")
    await command("press", "Escape")
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    assert.equal(Number((await command("get", "count", '[data-action="memory-capture-notifications"]')).trim()), 0)
    checks.push("native-capture-not-replayed-after-reload")
    await command("eval", 'window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("fill", '[contenteditable="true"]', "Remember the second native diagnostic convention.")
    await command("press", "Enter")
    await poll(
      async () => /记忆提取：已完成/.test(await command("get", "text", '[data-action="memory-capture-notifications"]')),
      "Chinese capture status",
      30_000,
    )
    await command("click", '[data-action="memory-capture-notifications"]')
    assert.match(await command("get", "text", '[role="dialog"]'), /记忆提取诊断/)
    assert.match(await command("get", "text", '[data-component="memory-capture-notifications"]'), /第 2–2 轮/)
    await command("screenshot", join(runtime.output, "memory-v2-native-capture-zh.png"))
    checks.push("native-capture-Chinese-details")
  } else if (process.argv.includes("--health")) {
    const calls = runtime.calls.length
    await command("click", '[data-action="session-memory"]')
    await button("Memory diagnostics")
    await command("wait", '[data-component="memory-health"]')
    await poll(
      async () => (await command("get", "text", '[data-component="memory-health"]')).includes("Visible observations"),
      "native health counts",
    )
    assert.doesNotMatch(await command("get", "text", '[data-component="memory-health"]'), /NATIVE_SEEDED_MEMORY/)
    assert.match(await command("get", "text", '[data-component="memory-health"] h3'), /Workspace/)
    await button("Refresh")
    assert.equal(runtime.calls.length, calls)
    checks.push("native-health-panel", "native-health-content-free", "native-health-refresh-without-model")
    await command("press", "Escape")
    await command("eval", 'window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("click", '[data-action="session-memory"]')
    await button("记忆诊断")
    await poll(
      async () => (await command("get", "text", '[data-component="memory-health"]')).includes("可见观察记录"),
      "native Chinese health",
    )
    assert.match(await command("get", "text", '[data-component="memory-health"] h3'), /工作区/)
    await command("screenshot", join(runtime.output, "memory-v2-native-health-zh.png"))
    checks.push("native-health-chinese")
  } else if (dream) {
    planned.hold = Promise.withResolvers()
    await command("fill", '[contenteditable="true"]', "/dream")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-work"]')
    await poll(() => dreamCalls.length === 1, "native Dream model")
    assert.match(await command("get", "text", '[data-component="memory-work"]'), /Consolidating saved notes/)
    await command("press", "Escape")
    await command("fill", '[contenteditable="true"]', "/dream")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-work"]')
    assert.equal(dreamCalls.length, 1)
    await button("Cancel")
    await poll(
      async () =>
        (await command("get", "text", '[data-component="memory-work"]')).includes("Memory operation cancelled."),
      "native cancel",
    )
    planned.hold.resolve()
    planned.hold = undefined
    await button("Consolidate memory")
    await poll(
      async () =>
        (await command("get", "text", '[data-component="memory-work"]')).includes("Memory operation completed."),
      "native Dream completed",
    )
    assert.match(await command("get", "text", '[data-component="memory-work"]'), /Topics: 2/)
    await command("press", "Escape")
    await command("click", '[data-action="session-memory"]')
    await command("wait", '[data-component="memory-preview"]')
    assert.match(await command("get", "text", '[data-component="memory-preview"]'), /NATIVE_DREAM_SAVED/)
    checks.push(
      "native-v2-dream",
      "native-dream-running",
      "native-dream-close-reopen",
      "native-dream-cancel-retry",
      "native-dream-topic-count",
      "native-dream-topic-preview",
    )
    await command("press", "Escape")
    await command("eval", 'window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("click", '[data-action="session-memory"]')
    await button("记忆整理")
    await poll(
      async () => (await command("get", "text", '[data-component="memory-work"]')).includes("主题数：2"),
      "native Chinese Dream",
    )
    await command("screenshot", join(runtime.output, "memory-v2-native-dream-zh.png"))
    checks.push("native-dream-chinese-result")
  } else {
    await command("click", '[data-action="session-memory"]')
    await command("wait", '[data-component="memory-browser"]')
    await command("wait", '[data-component="memory-preview"]')
    assert.match(await command("get", "text", '[data-component="memory-preview"]'), /NATIVE_SEEDED_MEMORY/)
    checks.push("native-sidecar-v2", "native-browser-preview")
    await command("click", '[data-action="memory-delete"]')
    await command("click", '[data-action="memory-delete-confirm"]')
    await poll(
      async () =>
        (await command("get", "text", '[data-component="memory-browser"]')).includes("No matching memory notes."),
      "native deletion",
    )
    checks.push("native-note-deletion")
    await command("press", "Escape")
    await command("fill", '[contenteditable="true"]', "/remember NATIVE_RAW_MANUAL")
    await command("press", "Enter")
    await command("wait", '[data-component="memory-review"]')
    await button("Save")
    await command("wait", '[data-component="memory-review"] code')
    assert.match(
      await command("get", "text", '[data-component="memory-review"] code'),
      /memory-v2\/apexo\/global\/observations\/_inbox\/remember-/,
    )
    checks.push("native-remember-save", "native-global-observation-path")
    await button("Close")
    await command("click", '[data-action="session-memory"]')
    await command("wait", '[data-component="memory-preview"]')
    assert.match(await command("get", "text", '[data-component="memory-preview"]'), /NATIVE_RAW_MANUAL/)
    await command("click", '[data-action="memory-toggle"]')
    await poll(
      async () => (await command("get", "text", '[data-component="memory-mode"]')).includes("disabled"),
      "native disable",
    )
    assert.equal(Number((await command("get", "count", "[data-memory-path]")).trim()), 0)
    await command("click", '[data-action="memory-toggle"]')
    await command("wait", '[data-component="memory-preview"]')
    checks.push("native-mode-toggle-preserves-notes")
    await command("screenshot", join(runtime.output, "memory-v2-native.png"))
    await command("press", "Escape")
    await command("eval", 'window.api.storeSet("apexo.global.dat", "language", JSON.stringify({locale:"zh"}))')
    await command("reload")
    await command("wait", '[data-action="session-memory"]')
    await command("click", '[data-action="session-memory"]')
    await command("wait", '[data-component="memory-preview"]')
    assert.match(await command("get", "text", '[data-component="memory-browser"]'), /全局|记忆/)
    await command("screenshot", join(runtime.output, "memory-v2-native-zh.png"))
    checks.push("native-chinese-memory-browser")
  }
  console.log(JSON.stringify({ dream, checks, passed: checks.length, output: runtime.output }, null, 2))
} catch (error) {
  if (port) {
    console.error(await command("snapshot", "-i").catch(String))
    await command("screenshot", join(runtime.output, "memory-v2-native-failure.png")).catch(() => {})
  }
  throw error
} finally {
  planned.hold?.resolve()
  if (port) await command("close").catch(() => {})
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10000, "native cleanup").catch(() => child.kill("SIGKILL"))
  await runtime.close()
  await writeFile(join(runtime.output, "memory-v2-native.json"), JSON.stringify({ checks, history }, null, 2))
  await writeFile(join(runtime.output, "native.log"), logs.join(""))
  console.error(`Native Memory V2 evidence: ${runtime.output}`)
}
