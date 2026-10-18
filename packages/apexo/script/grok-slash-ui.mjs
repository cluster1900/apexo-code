// Desktop (web app in Chrome via agent-browser) check of Grok Build slash commands: /multiline.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { poll } from "./grok-shell-fixture.mjs"
import {
  autoReviewFixture,
  dashboardFixture,
  dashboardTexts,
  importedClaude,
  seedClaude,
  seedDashboard,
  startGoalFixture,
} from "./grok-goal-fixture.mjs"
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
// --move: Desktop /move moves the session to another worktree of the project, optionally with its changes.
const moveFlow = process.argv.includes("--move") || process.argv.includes("--move-new")
const moveNew = process.argv.includes("--move-new")
// --mode-cycle: Shift+Tab cycles Normal → Plan → Auto → Always-approve like Grok Build.
const cycleFlow = process.argv.includes("--mode-cycle")
// --dashboard: /dashboard roster, peek, reply, permission answer, dispatch, search, delete (Grok Build agent dashboard).
const dashFlow = process.argv.includes("--dashboard")
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
  dashFlow
    ? dashboardFixture
    : autoFlow || cycleFlow
      ? autoReviewFixture
      : vimConfig
        ? { config: { ui: { vim_mode: true } } }
        : windowFlow
          ? { models: windowModels }
          : moveFlow
            ? { git: true }
            : {},
)
const session = await runtime.api("/session", {
  title: "Slash UI",
  agent: "build",
  model: { providerID: "xai", id: "grok-4.7" },
})
const seeded = dashFlow ? await seedDashboard(runtime) : undefined
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
  if (dashFlow) {
    // Mirrors the --dashboard TUI flow in grok-slash-tui.mjs step for step.
    const dash = "[data-dashboard]"
    const view = () => command("get", "text", "body")
    const shown = (text, timeout) => poll(async () => (await view()).includes(text), `render ${text}`, timeout)
    const open = async () => (await command("eval", `!!document.querySelector("[data-dashboard]")`)).trim() === "true"
    const order = async () =>
      JSON.parse(
        JSON.parse(
          await command(
            "eval",
            `JSON.stringify([...document.querySelectorAll("[data-dashboard-row]")].map((e) => e.textContent))`,
          ),
        ),
      )
    const lineOf = async (text) => (await order()).findIndex((line) => line.includes(text))
    const key = async (name, wait = 300) => {
      await command("press", name)
      await command("wait", String(wait))
    }
    const type = async (text) => {
      await command("keyboard", "type", text)
      await command("wait", "300")
    }
    const texts = (id) => dashboardTexts(runtime, id)
    const search = async (query) => {
      await key("Control+/")
      await poll(async () => (await command("get", "text", dash)).includes("Search:"), "search box")
      await type(query)
      await key("Enter")
    }
    await command("click", editor)
    await command("keyboard", "type", "/dashboard")
    await command("wait", "400")
    await command("press", "Enter")
    await shown("+ New Agent", 20_000)
    for (const chip of ["◆ 1 awaiting", "⋮ 1 working", "◇ 2 idle"]) await shown(chip)
    await shown("Pending: Bash echo dash-perm")
    assert.ok((await lineOf("Dash perm")) < (await lineOf("Dash busy")), "Awaiting sorts above Working")
    assert.ok((await lineOf("Dash busy")) < (await lineOf("Dash idle")), "Working sorts above Idle")
    checks.push("roster-sorted-by-state-with-header-chips")

    await key("ArrowDown")
    await shown("1. Allow once")
    await shown("3. Reject")
    checks.push("peek-shows-pending-permission-options")
    await key("1")
    await poll(
      async () => (await texts(seeded.perm)).includes("assistant:DASH_PERM_DONE"),
      "permission answered",
      30_000,
    )
    checks.push("peek-number-key-answers-permission")

    await search("busy")
    await poll(
      async () => (await lineOf("Dash idle")) === -1 && (await lineOf("Dash busy")) !== -1,
      "filter keeps only the busy row",
    )
    checks.push("ctrl-slash-search-filters-rows")
    await key("ArrowDown")
    await poll(
      async () => (await command("get", "text", "[data-dashboard-peek]").catch(() => "")).includes("Working"),
      "peek Working",
    )
    await type("DASH_REPLY one")
    await key("Enter")
    await shown("Reply queued")
    assert.ok(!(await texts(seeded.busy)).some((text) => text.includes("DASH_REPLY one")), "queued while busy")
    dashboardFixture.release()
    await poll(
      async () => (await texts(seeded.busy)).includes("assistant:DASH_REPLY_ACK one"),
      "queued reply delivered",
      30_000,
    )
    const busy = await texts(seeded.busy)
    assert.ok(
      busy.indexOf("assistant:DASH_BUSY_DONE") < busy.indexOf("user:DASH_REPLY one"),
      "delivered after the turn",
    )
    checks.push("peek-reply-to-busy-agent-queues-until-idle")

    await key("Escape")
    await key("Escape")
    await poll(async () => (await lineOf("Dash idle")) !== -1, "filter cleared by Esc")
    await search("Dash idle")
    await key("ArrowDown")
    await shown("DASH_IDLE_ANSWER first line")
    assert.equal((await command("get", "text", "[data-peek-type]")).trim(), "Response")
    checks.push("peek-shows-response-type-and-last-response")
    await type("DASH_REPLY two")
    await key("Control+s")
    await poll(
      async () => (await texts(seeded.idle)).includes("assistant:DASH_REPLY_ACK two"),
      "idle reply sent",
      30_000,
    )
    await poll(
      async () => !(await open()) && (await command("get", "url")).includes(seeded.idle),
      "Ctrl+S opened the agent",
    )
    await shown("DASH_REPLY_ACK two", 15_000)
    checks.push("ctrl-s-replies-and-opens-agent")
    await key("Control+\\", 600)
    await shown("+ New Agent")
    checks.push("ctrl-backslash-opens-dashboard")
    await key("Control+\\", 600)
    await poll(async () => !(await open()), "Ctrl+\\ inside the dashboard exits it")
    await key("Control+\\", 600)
    await shown("+ New Agent")
    checks.push("ctrl-backslash-toggles-dashboard-closed")

    const before = (await runtime.api("/session")).length
    await key("Tab")
    await type("DASH_DISPATCH new")
    await key("Enter")
    const created = await poll(async () => {
      const list = await runtime.api("/session")
      return list.length > before && list.find((item) => ![session.id, ...Object.values(seeded)].includes(item.id))
    }, "dispatched session")
    await poll(
      async () => (await texts(created.id)).includes("assistant:DASH_DISPATCH_ACK"),
      "dispatch answered",
      30_000,
    )
    await shown("Agent dispatched")
    assert.ok(await open(), "plain Enter stays on the dashboard")
    checks.push("dispatch-spawns-session-and-stays")

    await search("Dash perm")
    await key("ArrowDown")
    await key("Control+x")
    await shown("Press Ctrl+X again")
    await key("Control+x")
    await poll(
      async () => (await fetch(`${runtime.url}/session/${seeded.perm}`)).status === 404,
      "session deleted",
      15_000,
    )
    checks.push("ctrl-x-twice-deletes-settled-row")

    for (let index = 0; index < 4 && (await open()); index++) await key("Escape", 500)
    await poll(async () => !(await open()), "Esc closes the dashboard")
    checks.push("esc-steps-back-then-exits")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (cycleFlow) {
    const body = () => command("get", "text", "body")
    const store = () =>
      command(
        "eval",
        "JSON.stringify(Object.entries(localStorage).filter(([k]) => k.includes('permission')).map(([,v]) => v))",
      )
    await command("click", editor)
    const step = async (toast) => {
      await command("click", editor)
      await command("press", "Shift+Tab")
      await poll(async () => (await body()).includes(toast), toast)
      await command("wait", "300")
    }
    const messages = async () => runtime.api(`/session/${session.id}/message`)
    const agentOf = async (text) =>
      (await messages()).find((item) => item.info.role === "user" && JSON.stringify(item.parts).includes(text))?.info
        .agent
    const sendText = async (text) => {
      await command("click", editor)
      await command("keyboard", "type", text)
      await command("wait", "300")
      await command("press", "Enter")
      await poll(async () => (await agentOf(text)) !== undefined, `${text} sent`)
      await poll(async () => (await messages()).at(-1)?.info.time?.completed, "turn finished", 30_000)
    }
    await step("Plan mode")
    await sendText("PLAN_MARK")
    assert.equal(await agentOf("PLAN_MARK"), "plan", "Plan-mode prompt carries the plan agent")
    checks.push("shift-tab-plan-prompt-uses-plan-agent")
    await step("Auto-review mode")
    await sendText("BUILD_MARK")
    assert.equal(await agentOf("BUILD_MARK"), "build", "leaving Plan restores the previous agent")
    checks.push("leaving-plan-restores-agent")
    await poll(async () => /review[^}]*true/.test(await store()), "review on")
    checks.push("shift-tab-enters-auto-review")
    await step("Always-approve mode")
    await poll(
      async () => /autoAccept[^}]*true/.test(await store()) && !/review[^}]*true/.test(await store()),
      "always on",
    )
    checks.push("shift-tab-enters-always-approve")
    await step("Normal mode")
    await poll(
      async () => !/autoAccept[^}]*true/.test(await store()) && !/review[^}]*true/.test(await store()),
      "normal",
    )
    checks.push("shift-tab-returns-to-normal")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (moveNew) {
    const { join } = await import("node:path")
    const { existsSync, writeFileSync } = await import("node:fs")
    writeFileSync(join(runtime.directory, "dirty.txt"), "uncommitted\n")
    const body = () => command("get", "text", "body")
    await command("click", editor)
    await command("keyboard", "type", "/move")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await body()).includes("New worktree"), "dialog offers a new worktree", 20_000)
    await command("find", "text", "New worktree", "click")
    await poll(async () => (await body()).includes("uncommitted change"), "asks about changes", 60_000)
    await command("find", "text", "Yes, move the changes", "click")
    let moved
    await poll(
      async () => {
        moved = (await runtime.api(`/session/${session.id}`)).directory
        return moved !== runtime.directory
      },
      "session moved to the new worktree",
      60_000,
    )
    const project = (await runtime.api(`/session/${session.id}`)).projectID
    assert.ok(
      moved.startsWith(join(runtime.env.XDG_DATA_HOME, "apexo", "worktree", project.slice(0, 6))),
      `server-side location: ${moved}`,
    )
    checks.push("move-new-worktree-created-by-server-in-cli-location")
    const listed = await runtime.api(`/project/${project}/directories`)
    assert.ok(
      listed.some((item) => item.directory === moved),
      "new worktree is a known project directory",
    )
    checks.push("new-worktree-registered")
    await poll(async () => existsSync(join(moved, "dirty.txt")), "changes moved along", 20_000)
    checks.push("move-new-carries-changes")
    console.log(JSON.stringify({ kind, passed: checks.length, checks }))
  } else if (moveFlow) {
    const { dirname, join } = await import("node:path")
    const { realpathSync, writeFileSync } = await import("node:fs")
    const target = realpathSync(join(dirname(runtime.directory), "worktree-b"))
    await fetch(`${runtime.url}/path?directory=${encodeURIComponent(target)}`)
    writeFileSync(join(runtime.directory, "dirty.txt"), "uncommitted\n")
    const body = () => command("get", "text", "body")
    await command("click", editor)
    await command("keyboard", "type", "/move")
    await command("wait", "400")
    await command("press", "Enter")
    await poll(async () => (await body()).includes(target), "dialog lists the other worktree", 20_000)
    checks.push("move-lists-project-worktrees")
    await command("find", "text", target, "click")
    await poll(async () => (await body()).includes("uncommitted change"), "asks about changes", 20_000)
    checks.push("move-asks-about-uncommitted-changes")
    await command("find", "text", "No, leave them here", "click")
    await poll(async () => (await runtime.api(`/session/${session.id}`)).directory === target, "session moved", 30_000)
    checks.push("move-moves-session-directory")
    await poll(async () => (await body()).includes("Session moved to"), "moved toast", 20_000)
    assert.ok((await command("get", "url")).includes(session.id), "view stays on the session")
    await command("click", editor)
    await command("keyboard", "type", "AFTER_MOVE")
    await command("press", "Enter")
    await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`)).some(
          (item) => item.info.role === "user" && JSON.stringify(item.parts).includes("AFTER_MOVE"),
        ),
      "prompt after move reaches the session",
      30_000,
    )
    const reminder = (await runtime.api(`/session/${session.id}/message`)).some((item) =>
      JSON.stringify(item.parts).includes(`changed the current working directory to \\"${target}`),
    )
    assert.ok(reminder, "cwd reminder recorded")
    checks.push("move-follows-session")
    const { existsSync } = await import("node:fs")
    assert.ok(
      existsSync(join(runtime.directory, "dirty.txt")) && !existsSync(join(target, "dirty.txt")),
      "changes stayed",
    )
    checks.push("move-leaves-changes-when-asked")
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
    await poll(
      async () => (await pending()).some((item) => item.metadata?.command?.includes("terraform apply")),
      "model escalates",
    )
    await Bun.sleep(1500)
    assert.ok(
      (await pending()).some((item) => item.metadata?.command?.includes("terraform apply")),
      "still pending",
    )
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
