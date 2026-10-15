// Exercise the actual CLI clear command against live CLI/Electron sessions.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, deadline, poll } from "./grok-shell-fixture.mjs"

const requests = []
const commands = []
const scenarios = []
const flushes = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  next({ input, text, ancillary, finished }) {
    if (JSON.stringify(input).includes("You are a memory assistant extracting durable knowledge")) {
      flushes.push(Date.now())
      return { content: "## Clear lifecycle\nFRESH_IDLE_MEMORY_AFTER_CLEAR\n" }
    }
    if (ancillary) return { content: "Memory clear fixture" }
    const system = input
      .filter((item) => item.role === "system")
      .map((item) =>
        typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
      )
      .join("\n")
    requests.push({ memory: system.match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? "" })
    if (!finished && text.includes("MEMORY_CLEAR_SEED")) return { tool: "memory", args: { operation: "read" } }
    if (!finished && text.includes("MEMORY_CLEAR_SEARCH"))
      return { tool: "memory_search", args: { query: "database", min_score: 0 } }
    return { content: "MEMORY_CLEAR_ACK" }
  },
})
const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.ts")
async function clear(args, answer = "") {
  const child = spawn("bun", [entry, "memory", "clear", ...args], {
    cwd: runtime.directory,
    env: runtime.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const out = []
  child.stdout.on("data", (data) => out.push(data))
  child.stderr.on("data", (data) => out.push(data))
  child.stdin.on("error", () => {})
  child.stdin.end(answer)
  const code = await deadline(
    new Promise((resolve, reject) => {
      child.once("exit", resolve)
      child.once("error", reject)
    }),
    30_000,
    "memory clear CLI",
  ).catch((error) => {
    child.kill("SIGKILL")
    throw error
  })
  const text = Buffer.concat(out).toString()
  commands.push({ args, answer, code, text })
  return { code, text }
}
async function create() {
  return (await runtime.api("/session", { title: "Memory clear parity" })).id
}
async function prompt(id, text) {
  await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })
  return requests.at(-1).memory
}
async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  )
}
try {
  if (process.argv.includes("--git")) {
    for (const args of [
      ["init"],
      ["remote", "add", "origin", "https://example.invalid/memory/clear-fixture.git"],
      [
        "-c",
        "commit.gpgSign=false",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "test(memory): fixture",
      ],
    ])
      execFileSync("git", args, { cwd: runtime.directory, stdio: "pipe" })
  }
  await runtime.api(
    "/config",
    {
      memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
      compaction: { memory_flush: { enabled: false } },
    },
    "PATCH",
  )
  const seed = await create()
  await prompt(seed, "MEMORY_CLEAR_SEED Read memory")
  const file = (await runtime.api(`/session/${seed}/message`))
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool" && part.tool === "memory").state.metadata.path
  const root = dirname(file)
  const global = join(runtime.env.APEXO_TEST_HOME, ".grok/memory/MEMORY.md")
  const other = join(dirname(global), "unrelated/MEMORY.md")
  const legacy = join(
    dirname(global),
    `${basename(runtime.directory)}-${createHash("sha256").update(runtime.directory).digest("hex").slice(0, 8)}`,
    "MEMORY.md",
  )
  if (process.argv.includes("--git")) {
    assert.notEqual(legacy, file)
    await mkdir(dirname(legacy), { recursive: true })
    await writeFile(legacy, "## Database\ndatabase LEGACY_CLEAR_SECRET\n")
  }
  await mkdir(root, { recursive: true })
  await mkdir(dirname(other), { recursive: true })
  await writeFile(file, "## Database\ndatabase WORKSPACE_CLEAR_SECRET\n")
  await writeFile(global, "## Database\ndatabase GLOBAL_CLEAR_SECRET\n")
  await writeFile(other, "OTHER_PROJECT_KEEP")
  await mkdir(join(root, "sessions"))
  await writeFile(join(root, "sessions", "checkpoint.md"), "## Database\ndatabase SESSION_CLEAR_SECRET\n")
  const session = await create()
  assert.match(await prompt(session, "Investigate database transaction architecture."), /WORKSPACE_CLEAR_SECRET/)
  for (const answer of ["n\n", "\n", ""]) {
    const cancelled = await clear([], answer)
    assert.equal(cancelled.code, 0, cancelled.text)
    assert.match(cancelled.text, /Cancelled/)
    assert.ok(await exists(file))
  }
  scenarios.push("decline", "default-no", "EOF-cancels")
  const invalid = await clear(["--global", "--workspace", "--yes"])
  assert.notEqual(invalid.code, 0)
  assert.ok(await exists(file))
  scenarios.push("mutually-exclusive-scopes")
  const globalResult = await clear(["--global", "-y"])
  assert.equal(globalResult.code, 0, globalResult.text)
  assert.ok(!(await exists(global)))
  assert.ok(await exists(file))
  assert.ok(!(await prompt(session, "Continue database transaction architecture.")).includes("GLOBAL_CLEAR_SECRET"))
  scenarios.push("global-only", "short-yes", "live-global-context-invalidated")
  const workspaceResult = await clear(["--yes"])
  assert.equal(workspaceResult.code, 0, workspaceResult.text)
  assert.ok(!(await exists(root)))
  if (process.argv.includes("--git")) {
    assert.ok(!(await exists(legacy)))
    // Another clone's retained migration source must not revive the cleared project.
    await mkdir(dirname(legacy), { recursive: true })
    await writeFile(legacy, "## Database\ndatabase LEGACY_MUST_NOT_RETURN\n")
    scenarios.push("project-and-current-legacy-cleared")
  }
  assert.equal(await readFile(other, "utf8"), "OTHER_PROJECT_KEEP")
  assert.equal(await prompt(session, "Continue database transaction architecture."), "")
  if (process.argv.includes("--git")) scenarios.push("legacy-not-reimported-after-clear")
  scenarios.push(
    "default-workspace",
    "remove-notes-sessions-index",
    "preserve-other-project",
    "live-workspace-context-invalidated",
  )
  await prompt(session, "MEMORY_CLEAR_SEARCH Search database memory after clear")
  const tools = (await runtime.api(`/session/${session}/message`)).flatMap((message) => message.parts)
  const search = tools.findLast((part) => part.type === "tool" && part.tool === "memory_search")
  assert.equal(search.state.status, "completed", JSON.stringify(search))
  assert.ok(!search.state.output.includes("CLEAR_SECRET"), search.state.output)
  scenarios.push("live-index-reopened")
  await writeFile(file, "## Database\ndatabase FRESH_AFTER_CLEAR\n")
  assert.match(await prompt(await create(), "Investigate database transaction architecture."), /FRESH_AFTER_CLEAR/)
  scenarios.push("new-memory-indexes-after-clear")
  await writeFile(global, "## Database\ndatabase GLOBAL_NEW\n")
  const all = await clear(["--all"], "YES\n")
  assert.equal(all.code, 0, all.text)
  assert.ok(!(await exists(file)) && !(await exists(global)))
  assert.equal(await readFile(other, "utf8"), "OTHER_PROJECT_KEEP")
  scenarios.push("confirmed-all", "all-keeps-other-projects")
  const empty = await clear(["--workspace", "--yes"])
  assert.equal(empty.code, 0, empty.text)
  assert.match(empty.text, /Nothing to clear/)
  scenarios.push("explicit-workspace-empty-noop")
  const outside = join(runtime.output, "outside")
  await mkdir(outside)
  await writeFile(join(outside, "MEMORY.md"), "DO_NOT_DELETE")
  await symlink(outside, root)
  const redirected = await clear(["--workspace", "--yes"])
  assert.notEqual(redirected.code, 0, redirected.text)
  assert.equal(await readFile(join(outside, "MEMORY.md"), "utf8"), "DO_NOT_DELETE")
  await rm(root)
  scenarios.push("redirected-scope-rejected")
  await runtime.api(
    "/config",
    {
      memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
      compaction: { memory_flush: { enabled: true, idle_timeout_secs: 1 } },
    },
    "PATCH",
  )
  const idle = await create()
  await prompt(idle, "Capture useful database architecture decisions for this memory test.")
  await poll(() => flushes.length > 0, "positive idle flush control")
  await poll(
    async () =>
      (
        await readFile(
          join(root, "sessions", `${new Date().toISOString().slice(0, 10)}-${idle}-flush.md`),
          "utf8",
        ).catch(() => "")
      ).includes("FRESH_IDLE_MEMORY_AFTER_CLEAR"),
    "positive idle flush saved",
  )
  await runtime.api("/config", { compaction: { memory_flush: { enabled: true, idle_timeout_secs: 5 } } }, "PATCH")
  const pending = await create()
  await prompt(pending, "Capture another useful database architecture decision before clearing.")
  const before = flushes.length
  const started = Date.now()
  const pendingClear = await clear(["--workspace", "--yes"])
  assert.equal(pendingClear.code, 0, pendingClear.text)
  assert.ok(Date.now() - started < 4500, "Clear must finish before the configured five-second idle deadline")
  // This is the idle-time boundary under test, not a readiness delay.
  await new Promise((resolve) => setTimeout(resolve, 6000))
  assert.equal(flushes.length, before, "A pre-clear idle timer must not re-extract the cleared conversation")
  assert.ok(!(await exists(root)))
  scenarios.push("pre-clear-idle-timer-discarded")
  await prompt(pending, "Save a new database architecture decision after the explicit clear.")
  await poll(() => flushes.length > before, "new post-clear idle flush")
  await poll(
    async () =>
      (
        await readFile(
          join(root, "sessions", `${new Date().toISOString().slice(0, 10)}-${pending}-flush.md`),
          "utf8",
        ).catch(() => "")
      ).includes("FRESH_IDLE_MEMORY_AFTER_CLEAR"),
    "post-clear idle flush saved",
  )
  scenarios.push("post-clear-new-turn-can-save")
  console.log(JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", scenarios, output: runtime.output }))
} finally {
  await writeFile(
    join(runtime.output, "memory-clear.json"),
    JSON.stringify({ scenarios, requests, commands, flushes }, null, 2),
  )
  await runtime.close()
}
