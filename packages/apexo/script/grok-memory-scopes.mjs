// Exercise the actual CLI and packaged Electron registry, permissions and prompt context.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const cases = []
const sent = new Set()
const prompts = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  config: {
    memory: { enabled: true, session: { save_on_end: false }, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { memory_flush: { enabled: false } },
  },
  next({ body, text, ancillary, finished }) {
    const index = Number(text.match(/MEMORY_SCOPE_(\d+)/)?.[1])
    if (ancillary || finished || !Number.isInteger(index) || sent.has(index)) return
    sent.add(index)
    const prompt = JSON.stringify((body.messages ?? body.input).filter((message) => message.role === "system"))
    prompts[index] = Object.fromEntries(
      ["LEGACY_ORIGINAL", "LEGACY_CLONE", "GLOBAL_PREFERENCE", "WORKSPACE_SAVED", "NON_GIT_PRIVATE"].map((token) => [
        token,
        prompt.includes(token),
      ]),
    )
    return { tool: "memory", args: cases[index] }
  },
})
const evidence = []
const sessions = []
const api = async (directory, endpoint, body, method = body ? "POST" : "GET") => {
  const response = await fetch(`${runtime.url}${endpoint}?directory=${encodeURIComponent(directory)}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await response.text()
  assert.ok(response.ok, text)
  return text ? JSON.parse(text) : undefined
}
async function session(directory, permission) {
  const value = await api(directory, "/session", {
    title: "Memory scope parity",
    ...(permission ? { permission } : {}),
  })
  sessions.push({ directory, id: value.id })
  return { directory, id: value.id }
}
async function invoke(session, args, query = "preferences") {
  const index = cases.push(args) - 1
  const previous = new Set(
    (await api(session.directory, `/session/${session.id}/message`)).flatMap((message) =>
      message.parts.map((part) => part.id),
    ),
  )
  await api(session.directory, `/session/${session.id}/prompt_async`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: `MEMORY_SCOPE_${index} ${query}` }],
  })
  const part = await poll(
    async () =>
      (await api(session.directory, `/session/${session.id}/message`))
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            !previous.has(part.id) && part.type === "tool" && ["completed", "error"].includes(part.state.status),
        ),
    `memory result ${index}`,
  )
  await poll(
    async () => (await api(session.directory, "/session/status"))[session.id]?.type !== "busy",
    "memory parent idle",
  )
  evidence.push({ index, directory: session.directory, args, state: part.state, injected: prompts[index] })
  return part.state
}
function git(directory, ...args) {
  execFileSync("git", ["-c", "commit.gpgSign=false", ...args], { cwd: directory, stdio: "pipe" })
}
async function legacy(directory, content) {
  const target = join(
    runtime.env.APEXO_TEST_HOME,
    ".grok",
    "memory",
    `${basename(directory)}-${createHash("sha256").update(directory).digest("hex").slice(0, 8)}`,
    "MEMORY.md",
  )
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `# Memory\n\n- 2026-10-13T00:00:00.000Z — ${content}\n`)
  return target
}
try {
  const root = await realpath(runtime.output)
  const clone = join(root, "clone")
  const worktree = join(root, "linked")
  const unrelated = join(root, "unrelated")
  const plain = join(root, "plain")
  const otherPlain = join(root, "other-plain")
  git(runtime.directory, "init")
  git(
    runtime.directory,
    "-c",
    "user.name=Memory fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  )
  git(runtime.directory, "remote", "add", "origin", "https://example.invalid/acme/scopes.git")
  git(runtime.output, "clone", runtime.directory, clone)
  git(clone, "remote", "set-url", "origin", "git@example.invalid:acme/scopes.git")
  git(runtime.directory, "worktree", "add", "--detach", worktree)
  await mkdir(unrelated)
  await mkdir(plain)
  await mkdir(otherPlain)
  git(unrelated, "init")
  git(unrelated, "remote", "add", "origin", "https://different.invalid/acme/scopes.git")
  const oldOriginal = await legacy(runtime.directory, "LEGACY_ORIGINAL")
  await legacy(clone, "LEGACY_CLONE")
  const original = await session(runtime.directory)
  const first = await invoke(original, { operation: "read" }, "LEGACY_ORIGINAL")
  assert.equal(first.status, "completed")
  assert.match(first.output, /LEGACY_ORIGINAL/)
  assert.equal(evidence.at(-1).injected.LEGACY_ORIGINAL, true)
  const copied = await invoke(await session(clone), { operation: "read" }, "LEGACY_CLONE")
  assert.equal(copied.metadata.path, first.metadata.path)
  assert.match(copied.output, /LEGACY_ORIGINAL/)
  assert.match(copied.output, /LEGACY_CLONE/)
  assert.equal(evidence.at(-1).injected.LEGACY_CLONE, true)
  const linked = await invoke(await session(worktree), { operation: "read" })
  assert.equal(linked.metadata.path, first.metadata.path)
  assert.match(linked.output, /LEGACY_CLONE/)
  await invoke(original, { operation: "remember", content: "repository WORKSPACE_SAVED" })
  const global = await invoke(original, {
    operation: "remember",
    scope: "global",
    content: "preferences GLOBAL_PREFERENCE",
  })
  assert.equal(global.metadata.scope, "global")
  assert.notEqual(global.metadata.path, first.metadata.path)
  const outside = await invoke(await session(unrelated), { operation: "read" })
  assert.equal(outside.output, "Memory is empty.")
  assert.equal(evidence.at(-1).injected.GLOBAL_PREFERENCE, true)
  assert.equal(evidence.at(-1).injected.WORKSPACE_SAVED, false)
  const reloaded = await invoke(await session(clone), { operation: "read" }, "repository")
  assert.match(reloaded.output, /WORKSPACE_SAVED/)
  assert.equal(evidence.at(-1).injected.GLOBAL_PREFERENCE, false)
  assert.equal(evidence.at(-1).injected.WORKSPACE_SAVED, true)
  await invoke(await session(clone), { operation: "read", scope: "global" })
  assert.equal(evidence.at(-1).injected.GLOBAL_PREFERENCE, true)
  const seenGlobal = await invoke(await session(unrelated), { operation: "read", scope: "global" })
  assert.match(seenGlobal.output, /GLOBAL_PREFERENCE/)
  await invoke(await session(plain), { operation: "remember", content: "NON_GIT_PRIVATE" })
  const plainOther = await invoke(await session(otherPlain), { operation: "read" })
  assert.equal(plainOther.output, "Memory is empty.")
  assert.equal(evidence.at(-1).injected.NON_GIT_PRIVATE, false)
  assert.equal(evidence.at(-1).injected.GLOBAL_PREFERENCE, true)
  const denied = await invoke(await session(unrelated, [{ permission: "edit", pattern: "*", action: "deny" }]), {
    operation: "remember",
    scope: "global",
    content: "DENIED_PREFERENCE",
  })
  assert.equal(denied.status, "error")
  assert.ok(!(await readFile(global.metadata.path, "utf8")).includes("DENIED_PREFERENCE"))
  assert.equal((await invoke(original, { operation: "read", scope: "invalid" })).status, "error")
  await writeFile(first.metadata.path, "# Memory\n\nUSER_REMOVED_LEGACY\n")
  const edited = await invoke(original, { operation: "read" })
  assert.match(edited.output, /USER_REMOVED_LEGACY/)
  assert.ok(!edited.output.includes("LEGACY_ORIGINAL"))
  assert.match(await readFile(oldOriginal, "utf8"), /LEGACY_ORIGINAL/)
  console.log(
    JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", calls: evidence.length, output: runtime.output }),
  )
} finally {
  await Promise.all(
    sessions.map((session) =>
      api(session.directory, `/session/${session.id}/abort`, undefined, "POST").catch(() => {}),
    ),
  )
  await writeFile(join(runtime.output, "memory-scopes.json"), JSON.stringify(evidence, null, 2))
  await runtime.close()
  console.error(`Memory scopes evidence: ${runtime.output}`)
}
