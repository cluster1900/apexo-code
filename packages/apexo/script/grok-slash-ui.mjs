// Desktop (web app in Chrome via agent-browser) check of Grok Build slash commands: /multiline.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { poll } from "./grok-shell-fixture.mjs"
import { autoReviewFixture, importedClaude, seedClaude, startGoalFixture } from "./grok-goal-fixture.mjs"
const kind = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "cli"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
// --vim-config: config ui.vim_mode = true; checks the config default and the local override only.
const vimConfig = process.argv.includes("--vim-config")
// --context-window: the model lists several sizes; checks /context-window only.
const windowFlow = process.argv.includes("--context-window")
// --auto: bash asks; checks Auto-review approves a safe command and escalates a risky one.
const autoFlow = process.argv.includes("--auto")
// --import-claude: a seeded ~/.claude; checks the import modal and the written config and hooks.
const importFlow = process.argv.includes("--import-claude")
// --edit-prompt: checks the Desktop prompt editor dialog only.
const editFlow = process.argv.includes("--edit-prompt")
// --mode-cycle: Shift+Tab cycles Normal → Plan → Auto → Always-approve like Grok Build.
const cycleFlow = process.argv.includes("--mode-cycle")
const mod = process.platform === "darwin" ? "Meta" : "Control"
const windowModels = {
  "grok-4.7": {
    name: "Restart parity",
    tool_call: true,
    limit: { context: 100000, output: 10000, context_options: [100000, 50000, 100] },
  },
}
const { runtime, control } = await startGoalFixture(
  kind,
  autoFlow
    ? autoReviewFixture
    : vimConfig
      ? { config: { ui: { vim_mode: true } } }
      : windowFlow
        ? { models: windowModels }
        : {},
)
const session = await runtime.api("/session", {
  title: "Slash UI",
  agent: "build",
  model: { providerID: "xai", id: "grok-4.7" },
})
const replacementView = { frozen: undefined }
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
  if (replacementView.frozen && request.method === "GET" && url.pathname === `/session/${session.id}/goal`) {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(replacementView.frozen))
    return
  }
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
                `<head><script>new MutationObserver((_, observer) => {const element = document.querySelector('[contenteditable="true"]'); if(!element?.getBoundingClientRect().width) return; observer.disconnect(); requestAnimationFrame(()=>window.__pluginsComposerPaint=Date.now()-Number(sessionStorage.getItem('plugins-benchmark-start')));}).observe(document.documentElement,{childList:true,subtree:true});</script>`,
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
const browserSession = `slash-${kind}-${basename(runtime.output)}`
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

const checks = []
const url = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session/${session.id}`
const editor = '[contenteditable="true"]'
const userTexts = async () =>
  (await runtime.api(`/session/${session.id}/message`))
    .filter((item) => item.info.role === "user")
    .flatMap((item) => item.parts.filter((part) => part.type === "text").map((part) => part.text))
try {
  await command("open", url)
  await command("wait", editor)
  if (cycleFlow) {
    const body = () => command("get", "text", "body")
    const store = () =>
      command("eval", "JSON.stringify(Object.entries(localStorage).filter(([k]) => k.includes('permission')).map(([,v]) => v))")
    await command("click", editor)
    const step = async (toast) => {
      await command("click", editor)
      await command("press", "Shift+Tab")
      await poll(async () => (await body()).includes(toast), toast)
      await command("wait", "300")
    }
    await step("Plan mode")
    checks.push("shift-tab-enters-plan")
    await step("Auto-review mode")
    await poll(async () => /review[^}]*true/.test(await store()), "review on")
    checks.push("shift-tab-enters-auto-review")
    await step("Always-approve mode")
    await poll(async () => /autoAccept[^}]*true/.test(await store()) && !/review[^}]*true/.test(await store()), "always on")
    checks.push("shift-tab-enters-always-approve")
    await step("Normal mode")
    await poll(async () => !/autoAccept[^}]*true/.test(await store()) && !/review[^}]*true/.test(await store()), "normal")
    checks.push("shift-tab-returns-to-normal")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (editFlow) {
    const area = '[data-component="grok-edit-prompt"]'
    const value = async () => JSON.parse(await command("eval", `document.querySelector('${area}')?.value ?? null`))
    const draft = async () => (await command("get", "text", editor)).trim()
    await command("click", editor)
    await command("keyboard", "type", "DRAFT_ONE")
    await command("press", `${mod}+Shift+p`)
    await command("wait", "400")
    await command("keyboard", "type", "Edit prompt")
    await command("wait", "400")
    await command("press", "Enter")
    await command("wait", area)
    assert.equal(await value(), "DRAFT_ONE")
    checks.push("palette-opens-editor-with-draft")
    await command(
      "eval",
      `(() => { const a = document.querySelector('${area}'); a.value = 'EDITED_ONE line'; a.dispatchEvent(new Event('input', { bubbles: true })) })()`,
    )
    await command("click", '[data-action="grok-edit-prompt-save"]')
    await poll(
      async () => (await draft()).includes("EDITED_ONE line") && !(await draft()).includes("DRAFT_ONE"),
      "saved replaces",
    )
    checks.push("save-replaces-draft")
    await command("press", `${mod}+Shift+p`)
    await command("wait", "400")
    await command("keyboard", "type", "Edit prompt")
    await command("wait", "400")
    await command("press", "Enter")
    await command("wait", area)
    await command("eval", `document.querySelector('${area}').value = 'DISCARDED'`)
    await command("press", "Escape")
    await command("wait", "400")
    assert.equal(await value(), null)
    assert.ok((await draft()).includes("EDITED_ONE line"))
    checks.push("escape-keeps-draft")
    await command("click", editor)
    await command("press", `${mod}+a`)
    await command("press", "Backspace")
    await command("keyboard", "type", "/edit-prompt")
    await command("wait", "400")
    await command("press", "Enter")
    await command("wait", area)
    await command("keyboard", "type", "FROM_SLASH")
    await command("press", `${mod}+Enter`)
    await poll(async () => (await draft()).includes("FROM_SLASH"), "slash + mod+enter save")
    checks.push("slash-opens-editor-and-mod-enter-saves")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (importFlow) {
    await seedClaude(runtime)
    const body = () => command("get", "text", "body")
    const slash = async (text) => {
      await command("click", editor)
      await command("keyboard", "type", text)
      await command("wait", "400")
      await command("press", "Enter")
    }
    await slash("/import-claude")
    await poll(async () => {
      const text = await body()
      return ["Permissions", "Environment variables", "MCP servers", "Hooks", "Rule paths", "Import 5 selected"].every(
        (item) => text.includes(item),
      )
    }, "import modal sections")
    checks.push("modal-lists-claude-sections")
    await command("click", '[data-grok-item="☑ Rule paths (~/.claude/rules)"]')
    await poll(async () => (await body()).includes("Import 4 selected"), "untick paths")
    await command("click", '[data-grok-item="☐ Rule paths (~/.claude/rules)"]')
    await poll(async () => (await body()).includes("Import 5 selected"), "tick paths")
    checks.push("sections-toggle")
    await command("click", '[data-grok-item="Import 5 selected"]')
    await poll(async () => (await body()).includes("Imported Claude settings"), "import toast", 20_000)
    await poll(async () => Object.values(await importedClaude(runtime)).every(Boolean), "config written")
    checks.push("chosen-sections-written-to-global-config")
    const { readFile } = await import("node:fs/promises")
    const hooks = JSON.parse(
      await readFile(join(runtime.env.APEXO_TEST_HOME, ".grok", "hooks", "claude-import.json"), "utf8"),
    )
    assert.equal(hooks.hooks.Stop.length, 1)
    checks.push("hooks-written-to-grok-hooks-dir")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (autoFlow) {
    const body = () => command("get", "text", "body")
    const slash = async (text) => {
      await command("click", editor)
      await command("keyboard", "type", text)
      await command("wait", "400")
      await command("press", "Enter")
    }
    const pending = async () => runtime.api(`/permission`)
    const tool = async (marker) =>
      (await runtime.api(`/session/${session.id}/message`)).some((item) =>
        item.parts.some(
          (part) =>
            part.type === "tool" &&
            part.state.status === "completed" &&
            JSON.stringify(part.state.input).includes(marker),
        ),
      )
    await slash("/auto")
    await poll(async () => (await body()).includes("Auto-review on"), "auto toast")
    checks.push("auto-toggles-review-mode")
    await slash("AUTO_SAFE")
    await poll(() => tool("git status"), "safe command ran without a prompt", 30_000)
    checks.push("safe-command-auto-approved")
    await slash("AUTO_RISKY")
    await poll(async () => (await pending()).some((item) => item.metadata?.command?.includes("rm -rf")), "risky asks")
    await poll(async () => (await body()).includes("rm -rf"), "permission prompt shown")
    checks.push("risky-command-escalates-to-prompt")
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    assert.equal(autoReviewFixture.classified.length, 0, "rules decided safe/risky without the model")
    await slash("AUTO_MODEL_ALLOW")
    await poll(() => tool("terraform plan"), "model-approved command ran", 30_000)
    assert.ok(autoReviewFixture.classified.some((item) => item.includes("terraform plan")))
    checks.push("model-classifier-approves-unknown-safe-command")
    await slash("AUTO_MODEL_ASK")
    await poll(async () => (await pending()).some((item) => item.metadata?.command?.includes("terraform apply")), "model escalates")
    await Bun.sleep(1500)
    assert.ok((await pending()).some((item) => item.metadata?.command?.includes("terraform apply")), "still pending")
    checks.push("model-classifier-escalates-risky-command")
    for (const item of await pending()) await runtime.api(`/permission/${item.id}/reply`, { reply: "reject" })
    await slash("/always-approve")
    const permissionStore = () =>
      command(
        "eval",
        "JSON.stringify(Object.entries(localStorage).filter(([k]) => k.includes('permission')).map(([,v]) => v))",
      )
    await poll(async () => /autoAccept[^}]*true/.test(await permissionStore()), "always-approve on")
    await slash("/auto")
    await poll(async () => (await body()).includes("Auto-review on"), "auto again")
    const store = await command(
      "eval",
      "JSON.stringify(Object.entries(localStorage).filter(([k]) => k.includes('permission')).map(([,v]) => v))",
    )
    assert.ok(/review[^}]*true/.test(store), "review persisted")
    assert.ok(!/autoAccept[^}]*true/.test(store), "always-approve switched off")
    checks.push("auto-replaces-always-approve")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (windowFlow) {
    const body = () => command("get", "text", "body")
    const slash = async (text) => {
      await command("click", editor)
      await command("keyboard", "type", text)
      await command("wait", "400")
      await command("press", "Enter")
    }
    await slash("/context-window")
    await poll(async () => /100k[\s\S]*50k/.test(await body()), "window dialog sizes")
    checks.push("context-window-lists-model-sizes")
    await command("press", "Escape")
    await command("wait", "300")
    await slash("/context-window 2M ")
    await poll(async () => (await body()).includes("Unsupported context window"), "rejects 2M")
    checks.push("context-window-rejects-unsupported")
    await slash("/context-window 50000 ")
    await poll(async () => (await body()).includes("Context window set to 50k"), "set 50k")
    await command("click", editor)
    await command("keyboard", "type", "CW_PROMPT")
    await command("press", "Enter")
    const users = async () =>
      (await runtime.api(`/session/${session.id}/message`)).filter((item) => item.info.role === "user")
    await poll(
      async () => (await users()).some((item) => item.info.model.contextWindow === 50000),
      "prompt carries 50k",
    )
    checks.push("prompt-carries-session-window")
    await poll(async () => (await runtime.api(`/session/${session.id}/message`)).at(-1)?.info.time?.completed, "reply")
    await slash("/context-window 100 ")
    await poll(async () => (await body()).includes("compacting to fit"), "compacting toast")
    await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`)).some((item) =>
          item.parts.some((part) => part.type === "compaction"),
        ),
      "auto-compact started",
    )
    checks.push("smaller-than-usage-starts-auto-compact")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (vimConfig) {
    await runtime.api(`/session/${session.id}/message`, {
      agent: "build",
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: "VIM_CONFIG" }],
    })
    await poll(async () => (await command("get", "text", "body")).includes("VIM_CONFIG"), "seeded")
    await command("click", editor)
    await command("press", "Escape")
    await command("press", "y")
    await poll(async () => (await command("get", "text", "body")).includes("Last response copied"), "config vim y")
    checks.push("config-ui-vim-mode-enables-scrollback")
    await command("click", editor)
    await command("keyboard", "type", "/vim-mode")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await command("get", "text", "body")).includes("Vim mode off"), "vim off toast")
    await command("click", editor)
    await command("press", "Escape")
    await command("press", "y")
    await command("wait", "500")
    assert.match(await command("get", "text", editor), /^\s*y\s*$/)
    checks.push("local-toggle-overrides-config")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else {
    await command("click", editor)
    await command("keyboard", "type", "/multiline")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await command("get", "text", "body")).includes("Multiline on"), "multiline toast")
    assert.equal(await command("eval", "localStorage.getItem('apexo.multiline')").then((v) => v.trim()), '"on"')
    checks.push("multiline-toggle-persisted")
    await command("click", editor)
    await command("keyboard", "type", "MLA")
    await command("press", "Enter")
    await command("keyboard", "type", "MLB")
    await command("wait", "300")
    assert.deepEqual(await userTexts(), [])
    assert.match(await command("get", "text", editor), /MLA\s*\n\s*MLB/)
    checks.push("enter-inserts-newline")
    await command("press", "Alt+Enter")
    await poll(
      async () => (await userTexts()).some((text) => text.replace(/\r/g, "") === "MLA\nMLB"),
      "Alt+Enter sends",
    )
    checks.push("alt-enter-sends")
    await command("click", editor)
    await command("keyboard", "type", "/ml")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await command("get", "text", "body")).includes("Multiline off"), "multiline off toast")
    checks.push("ml-alias-turns-off")
    // Seed a long session so the timeline scrolls and g/G can be verified.
    for (let index = 0; index < 8; index++)
      await runtime.api(`/session/${session.id}/message`, {
        agent: "build",
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text: `SEED_${index}\n` + "filler line\n".repeat(12) }],
      })
    await command("set", "viewport", "1100", "500")
    await command("reload")
    await command("wait", editor)
    await poll(async () => (await command("get", "text", "body")).includes("SEED_7"), "seeded timeline")
    await command("wait", "500")
    await command("click", editor)
    await command("keyboard", "type", "/vim-mode")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await command("get", "text", "body")).includes("Vim mode on"), "vim toast")
    await command("click", editor)
    await command("press", "Escape")
    assert.equal((await command("eval", "document.activeElement?.isContentEditable === true")).trim(), "false")
    // y copies the last response (clipboard may be denied headless; either toast proves the key reached the action).
    await command("press", "y")
    await command("wait", "800")
    await poll(
      async () => /Last response copied|Request failed|clipboard/i.test(await command("get", "text", "body")),
      "y copy",
    )
    const scroll = (
      await command(
        "eval",
        `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; if (!e) return "none"; e.scrollTop = e.scrollHeight; return "ok" })()`,
      )
    ).trim()
    assert.ok(scroll.includes("ok"), "seeded timeline must scroll")
    {
      await command("press", "g")
      await command("wait", "300")
      assert.equal(
        (
          await command(
            "eval",
            `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return e.scrollTop })()`,
          )
        ).trim(),
        "0",
      )
      checks.push("vim-g-scrolls-to-top")
      await command("press", "Shift+g")
      await command("wait", "400")
      const bottom = (
        await command(
          "eval",
          `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return Math.abs(e.scrollHeight - e.clientHeight - e.scrollTop) < 4 })()`,
        )
      ).trim()
      assert.equal(bottom, "true")
      checks.push("vim-G-scrolls-to-bottom")
      await command("press", "g")
      await command("wait", "400")
      await command("press", "j")
      await command("wait", "400")
      const after = (
        await command(
          "eval",
          `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return e.scrollTop })()`,
        )
      ).trim()
      assert.ok(Number(after) > 0, `j scrolls down (scrollTop=${after})`)
      checks.push("vim-j-scrolls-a-line")
    }
    await command("press", "x")
    assert.equal((await command("eval", "document.activeElement?.isContentEditable === true")).trim(), "true")
    assert.match(await command("get", "text", editor), /^\s*x\s*$/)
    checks.push("vim-mode-escape-scrollback-y-and-typing-returns-to-prompt")
    const height = async () =>
      Number(
        (
          await command(
            "eval",
            `(() => { let e = document.querySelector("[data-message-id]")?.parentElement; while (e && !(/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)) e = e.parentElement; return e.scrollHeight })()`,
          )
        ).trim(),
      )
    await command("press", "Backspace")
    const loose = await height()
    await command("keyboard", "type", "/compact-mode")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await command("get", "text", "body")).includes("Compact display on"), "compact toast")
    await command("wait", "400")
    const dense = await height()
    assert.ok(dense < loose, `compact timeline is shorter (${loose} -> ${dense})`)
    assert.equal((await command("eval", "document.documentElement.dataset.compact")).trim(), '"on"')
    checks.push(`compact-mode-denser-timeline:${loose}->${dense}`)
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  }
} finally {
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.close()
  await writeFile(join(runtime.output, "slash-ui.json"), JSON.stringify({ checks, history }, null, 2))
  console.error(`Slash UI evidence: ${runtime.output}`)
}
