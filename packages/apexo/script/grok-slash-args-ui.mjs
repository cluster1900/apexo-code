// Desktop (web app in Chrome via agent-browser) check that Grok Build slash commands typed with arguments run locally
// and never reach the model: /rename <title>, /copy [N] [path], /resume [query], /session-info, /agents, /model <name>,
// mid-message /btw, and exact short aliases in the slash menu. Run from packages/apexo after `bun run build` in
// packages/app: `bun script/grok-slash-args-ui.mjs`.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { poll } from "./grok-shell-fixture.mjs"
import { startGoalFixture } from "./grok-goal-fixture.mjs"

const kind = "desktop"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const replies = ["FIRST_REPLY_MARKDOWN", "SECOND_REPLY_MARKDOWN"]
const { runtime } = await startGoalFixture(kind, {
  models: { "grok-mini": { name: "Mini Reasoner", tool_call: true, limit: { context: 50000, output: 5000 } } },
  // Distinct replies so /copy N can be told apart; ancillary (title/side-question) requests answer plainly.
  next: ({ ancillary, text }) =>
    ancillary
      ? { content: text.includes("SIDE_MARKER") ? "SIDE_ANSWER" : "Fixture title" }
      : { content: replies.shift() ?? "LATER_REPLY" },
})
const model = { providerID: "xai", id: "grok-4.7" }
const session = await runtime.api("/session", { title: "Slash args main", agent: "build", model })
const release = await runtime.api("/session", { title: "Release notes draft", agent: "build", model })
const triage = await runtime.api("/session", { title: "Bug triage notes", agent: "build", model })
for (const text of ["SEED_ONE", "SEED_TWO"])
  await runtime.api(`/session/${session.id}/message`, {
    agent: "build",
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost")
  const document = request.headers.accept?.includes("text/html")
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
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const browserSession = `slash-args-${basename(runtime.output)}`
const history = []
const cachedBin =
  typeof process.getuid === "function"
    ? join(tmpdir(), `bunx-${process.getuid()}-agent-browser@latest`, "node_modules", ".bin", "agent-browser")
    : undefined
const command = async (...args) => {
  const direct = Boolean(cachedBin && existsSync(cachedBin))
  const browserArgs = [
    "--session",
    browserSession,
    "--executable-path",
    process.env.CHROMIUM_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...args,
  ]
  const bin = process.env.APEXO_AGENT_BROWSER ?? (direct ? cachedBin : "bunx")
  const result = await promisify(execFile)(bin, bin === "bunx" ? ["agent-browser", ...browserArgs] : browserArgs, {
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  history.push({ args, output: result.stdout })
  return result.stdout
}

const checks = []
const aliases = {}
const base = `http://127.0.0.1:${server.address().port}/${Buffer.from(runtime.directory).toString("base64url")}/session`
const editor = '[contenteditable="true"]'
const body = () => command("get", "text", "body")
const evaluate = async (script) => JSON.parse((await command("eval", script)).trim() || "null")
const messages = (id = session.id) => runtime.api(`/session/${id}/message`)
const userTexts = async (id = session.id) =>
  (await messages(id))
    .filter((item) => item.info.role === "user")
    .flatMap((item) => item.parts.filter((part) => part.type === "text").map((part) => part.text))
const type = async (text) => {
  await command("click", editor)
  await command("keyboard", "type", text)
  await command("wait", "400")
}
const slash = async (text) => {
  await type(text)
  await command("press", "Enter")
  await command("wait", "500")
}
const closeDialog = async () => {
  await command("press", "Escape")
  await command("wait", "300")
}
// Quiescence: the seeded turns may still trigger title work; wait until the provider stops receiving requests.
const settle = async () => {
  let last = -1
  await poll(
    async () => {
      const now = runtime.calls.length
      const stable = now === last
      last = now
      if (!stable) await new Promise((done) => setTimeout(done, 1200))
      return stable
    },
    "provider idle",
    30_000,
  )
}
// Asserts the step sent nothing to the model: no provider request and no new user message in the main session.
const quiet = async (label, step) => {
  const calls = runtime.calls.length
  const users = (await userTexts()).length
  await step()
  await command("wait", "800")
  assert.equal(
    runtime.calls.length,
    calls,
    `${label}: provider received ${JSON.stringify(runtime.calls.slice(calls))}; users ${JSON.stringify(await userTexts())}`,
  )
  assert.equal((await userTexts()).length, users, `${label}: a user message reached the session`)
  checks.push(label)
}

try {
  await poll(async () => (await messages()).filter((item) => item.info.role === "assistant").length >= 2, "seed", 30_000)
  await settle()
  await command("open", `${base}/${session.id}`)
  await command("wait", editor)
  await poll(async () => (await body()).includes("SECOND_REPLY_MARKDOWN"), "seeded transcript", 30_000)
  // Capture clipboard writes (headless Chrome denies the real clipboard); the app still calls writeText itself.
  const captureClipboard = () =>
    command(
      "eval",
      `navigator.clipboard.writeText = (text) => { window.__copied = text; return Promise.resolve() }; window.__copied = null; true`,
    )
  await captureClipboard()

  // Item 9: the exact short alias is the active (Enter) row of the slash menu.
  for (const [alias, id] of [
    ["m", "model.choose"],
    ["t", "theme.cycle"],
    ["ml", "grok.multiline"],
    ["mem", "session.memory"],
  ]) {
    await type(`/${alias}`)
    aliases[alias] = await evaluate(
      `JSON.stringify({ active: document.querySelector("[data-suggestion-id].bg-v2-overlay-simple-overlay-hover")?.getAttribute("data-suggestion-id") ?? document.querySelector("[data-slash-id].bg-surface-raised-base-hover")?.getAttribute("data-slash-id") ?? null, listed: [...document.querySelectorAll("[data-suggestion-id],[data-slash-id]")].map((e) => e.getAttribute("data-suggestion-id") ?? e.getAttribute("data-slash-id")) })`,
    ).then((value) => (typeof value === "string" ? JSON.parse(value) : value))
    await command("press", "Escape")
    await command("press", "Meta+a")
    await command("press", "Backspace")
    await command("wait", "200")
    if (aliases[alias].listed.includes(id))
      assert.equal(aliases[alias].active, id, `/${alias} highlights ${aliases[alias].active} instead of ${id}`)
  }
  checks.push(`exact-alias-first:${JSON.stringify(Object.fromEntries(Object.entries(aliases).map(([k, v]) => [k, v.active])))}`)

  // Item 1/2: registered commands typed with arguments or a trailing space run locally.
  await quiet("rename-with-title-sets-title", async () => {
    await slash("/rename Renamed by slash")
    await poll(async () => (await runtime.api(`/session/${session.id}`)).title === "Renamed by slash", "renamed")
  })
  await quiet("command-without-arg-handler-ignores-args", async () => {
    await slash("/themes ignored words")
  })
  await quiet("trailing-space-runs-command", async () => {
    await slash("/usage ")
    await poll(async () => (await body()).includes("Usage") || (await body()).includes("usage"), "usage dialog")
    await closeDialog()
  })
  await quiet("model-with-name-switches-model", async () => {
    await slash("/model mini reasoner")
    await poll(async () => (await body()).includes("Model set to Mini Reasoner"), "model toast")
  })
  await quiet("model-unknown-name-toasts", async () => {
    await slash("/model no-such-model")
    await poll(async () => (await body()).includes('No model matches "no-such-model"'), "missing model toast")
  })

  // Item 3: /copy copies the latest response's markdown; /copy N the Nth latest; a path is terminal-only.
  await quiet("copy-latest-response", async () => {
    await slash("/copy")
    await poll(async () => (await evaluate("window.__copied")) === "SECOND_REPLY_MARKDOWN", "copy latest")
  })
  await quiet("copy-nth-response", async () => {
    await slash("/copy 2")
    await poll(async () => (await evaluate("window.__copied")) === "FIRST_REPLY_MARKDOWN", "copy 2")
  })
  await quiet("copy-missing-response-toasts", async () => {
    await slash("/copy 7")
    await poll(async () => (await body()).includes("No response 7 to copy"), "copy 7 toast")
  })
  await quiet("copy-path-is-terminal-only", async () => {
    await command("eval", "window.__copied = null; true")
    await slash("/copy out.txt")
    await poll(async () => (await body()).includes("only available in the terminal"), "copy path toast")
    assert.equal(await evaluate("window.__copied"), null)
  })

  // Item 6: /session-info and /status show this session's details; `c` copies the session ID.
  await quiet("session-info-shows-session-details", async () => {
    await slash("/session-info")
    await poll(async () => (await body()).includes("Session info"), "session info dialog")
    const text = await body()
    assert.ok(text.includes(session.id), "session ID shown")
    assert.ok(text.includes("Renamed by slash"), "title shown")
    assert.match(text, /Turns\s*2/)
    await command("press", "c")
    await poll(async () => (await evaluate("window.__copied")) === session.id, "c copies session ID")
    await closeDialog()
  })
  await quiet("status-alias-opens-session-info", async () => {
    await slash("/status")
    await poll(async () => (await body()).includes("Session info"), "status alias")
    await closeDialog()
  })

  // Item 4: /agents opens a picker and changes nothing until a pick.
  await quiet("agents-opens-picker-without-switching", async () => {
    await slash("/agents")
    await poll(async () => (await body()).includes("Agents"), "agents dialog")
    const items = await evaluate(
      `JSON.stringify([...document.querySelectorAll("[data-grok-item]")].map((e) => e.getAttribute("data-grok-item")))`,
    ).then((value) => JSON.parse(value))
    assert.ok(items.includes("build") && items.includes("plan"), `agent picker lists ${items}`)
    await closeDialog()
  })
  await type("AGENT_AFTER_ESCAPE")
  await command("press", "Enter")
  await poll(async () => (await userTexts()).includes("AGENT_AFTER_ESCAPE"), "prompt after escape", 30_000)
  const afterEscape = (await messages()).findLast((item) => item.info.role === "user")
  assert.equal(afterEscape.info.agent, "build", "agent unchanged after dismissing /agents")
  checks.push("agents-escape-keeps-build")
  await poll(
    async () => (await messages()).at(-1)?.info.role === "assistant" && (await messages()).at(-1)?.info.time?.completed,
    "reply after escape",
    30_000,
  )
  await settle()
  await slash("/agents")
  await poll(async () => (await body()).includes("Agents"), "agents dialog again")
  await command("keyboard", "type", "plan")
  await command("wait", "300")
  await command("press", "Enter")
  await command("wait", "400")
  await type("AGENT_AFTER_PICK")
  await command("press", "Enter")
  await poll(async () => (await userTexts()).includes("AGENT_AFTER_PICK"), "prompt after pick", 30_000)
  assert.equal((await messages()).findLast((item) => item.info.role === "user").info.agent, "plan")
  checks.push("agents-pick-switches-to-plan")
  await poll(
    async () => (await messages()).at(-1)?.info.role === "assistant" && (await messages()).at(-1)?.info.time?.completed,
    "reply after pick",
    30_000,
  )
  await settle()

  // Item 7: mid-message /btw goes to the side question; nothing reaches the main turn.
  {
    const users = (await userTexts()).length
    await slash("fix the retry loop first. /btw what does SIDE_MARKER stand for?")
    await poll(async () => (await body()).includes("SIDE_MARKER"), "side question shown", 30_000)
    await command("wait", "1500")
    assert.equal((await userTexts()).length, users, "mid-message /btw reached the main session")
    assert.ok(!(await userTexts()).some((text) => text.includes("SIDE_MARKER")))
    checks.push("mid-message-btw-is-side-question")
    await closeDialog()
    await settle()
  }

  // Item 5: /resume opens a picker filtered with Grok's word rule; an exact reference opens the session directly.
  await quiet("resume-picker-filters-by-words", async () => {
    await slash("/resume")
    await poll(async () => (await body()).includes("Resume session"), "resume dialog")
    await command("keyboard", "type", "notes release")
    await command("wait", "500")
    const rows = await evaluate(
      `JSON.stringify([...document.querySelectorAll("[data-resume-session]")].map((e) => e.getAttribute("data-resume-session")))`,
    ).then((value) => JSON.parse(value))
    assert.deepEqual(rows, [release.id])
    await closeDialog()
  })
  await quiet("resume-ambiguous-query-prefills-picker", async () => {
    await slash("/resume notes")
    await poll(async () => (await body()).includes("Resume session"), "prefilled resume dialog")
    await command("wait", "300")
    const rows = await evaluate(
      `JSON.stringify([...document.querySelectorAll("[data-resume-session]")].map((e) => e.getAttribute("data-resume-session")))`,
    ).then((value) => JSON.parse(value))
    assert.deepEqual([...rows].sort(), [release.id, triage.id].sort())
    await closeDialog()
  })
  await quiet("resume-exact-title-opens-session", async () => {
    await slash("/resume bug-triage-notes")
    await poll(async () => (await command("get", "url")).includes(triage.id), "opened triage session")
  })
  await command("wait", editor)
  await captureClipboard()
  await quiet("resume-exact-id-opens-session", async () => {
    await slash(`/resume ${session.id}`)
    await poll(async () => (await command("get", "url")).includes(session.id), "back to main session")
  })
  console.log(JSON.stringify({ kind, passed: checks.length, checks, aliases }))
} finally {
  await command("close").catch(() => {})
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  await runtime.close()
  await writeFile(join(runtime.output, "slash-args-ui.json"), JSON.stringify({ checks, aliases, history }, null, 2))
  console.error(`Slash args UI evidence: ${runtime.output}`)
}
