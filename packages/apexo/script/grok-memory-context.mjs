// Inspect real model requests through the CLI and production Electron backend.
import assert from "node:assert/strict"
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const requests = []
const scenarios = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  next({ input, text, ancillary, finished }) {
    if (ancillary) return { content: "The user is investigating database transactions. Continue that task." }
    const system = input
      .filter((item) => item.role === "system")
      .map((item) =>
        typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
      )
      .join("\n")
    requests.push({ text, memory: system.match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? "", system })
    if (!finished && text.includes("CONTEXT_SEED")) return { tool: "memory", args: { operation: "read" } }
    return { content: "CONTEXT_ACK" }
  },
})
async function create(permission) {
  return (await runtime.api("/session", { title: "Memory context parity", ...(permission ? { permission } : {}) })).id
}
async function prompt(id, text) {
  const before = requests.length
  await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text }],
  })
  assert.ok(requests.length > before, "Expected a main provider request")
  return requests.at(-1)
}
async function configure(memory = {}) {
  await runtime.api(
    "/config",
    {
      memory: {
        enabled: true,
        initial_injection: { enabled: true, min_score: 0.9 },
        session: { save_on_end: false },
        dream: { enabled: false, check_interval_secs: 0 },
        ...memory,
      },
      compaction: { auto: false, memory_flush: { enabled: false } },
    },
    "PATCH",
  )
}
try {
  await configure()
  const seed = await create()
  await prompt(seed, "CONTEXT_SEED Read the workspace memory path.")
  const file = (await runtime.api(`/session/${seed}/message`))
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool" && part.tool === "memory").state.metadata.path
  const topics = join(dirname(file), "topics")
  await mkdir(topics, { recursive: true })
  const topic = join(topics, "database.md")
  await writeFile(file, "# Irrelevant\nUNRELATED_NOTE_MUST_NOT_AUTOLOAD\n")
  await writeFile(topic, "# Database\ndatabase ORIGINAL_DATABASE_CONTEXT\n")
  const first = await create()
  const initial = await prompt(first, "Investigate database transaction retry boundaries.")
  assert.match(initial.memory, /ORIGINAL_DATABASE_CONTEXT/)
  assert.ok(!initial.system.includes("UNRELATED_NOTE_MUST_NOT_AUTOLOAD"))
  assert.match(initial.memory, /source: workspace/)
  assert.match(initial.memory, /lines 1-3/)
  scenarios.push("relevant-first-turn", "irrelevant-note-excluded", "source-and-lines")
  await writeFile(topic, "# Database\ndatabase UPDATED_DATABASE_CONTEXT\n")
  assert.equal((await prompt(first, "Continue investigating the database.")).memory, initial.memory)
  scenarios.push("stable-prefix-after-edit")
  await runtime.api("/instance/dispose", undefined, "POST")
  assert.equal((await prompt(first, "Resume investigating the database.")).memory, initial.memory)
  scenarios.push("persisted-after-instance-reload")
  assert.match(
    (await prompt(await create(), "Investigate database transaction retry boundaries.")).memory,
    /UPDATED_DATABASE_CONTEXT/,
  )
  scenarios.push("new-session-refresh")
  await runtime.api(
    `/session/${first}`,
    { permission: [{ permission: "read", pattern: topic, action: "deny" }] },
    "PATCH",
  )
  assert.equal((await prompt(first, "Continue database work after a permission change.")).memory, "")
  scenarios.push("cached-permission-revocation")
  for (const [name, permission] of [
    ["read-denied", [{ permission: "read", pattern: "*", action: "deny" }]],
    ["read-ask-no-prompt", [{ permission: "read", pattern: "*", action: "ask" }]],
    ["canonical-read-denied", [{ permission: "read", pattern: await realpath(topic), action: "deny" }]],
  ]) {
    assert.equal(
      (await prompt(await create(permission), "Investigate database transaction retry boundaries.")).memory,
      "",
    )
    assert.deepEqual(await runtime.api("/permission"), [])
    scenarios.push(name)
  }
  const compact = await create()
  const before = await prompt(compact, "Investigate database transaction retry boundaries.")
  await writeFile(topic, "# Database\ndatabase COMPACTED_DATABASE_CONTEXT\n")
  await runtime.api(`/session/${compact}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  const recovered = await prompt(compact, "Continue the investigation.")
  assert.match(recovered.memory, /COMPACTED_DATABASE_CONTEXT/)
  assert.notEqual(recovered.memory, before.memory)
  assert.ok(
    (await runtime.api(`/session/${compact}/message`)).some((message) => message.info.summary && message.info.finish),
  )
  scenarios.push("actual-compaction-refresh")
  const empty = await create()
  assert.equal((await prompt(empty, "Investigate zzzmissingtoken boundary behavior.")).memory, "")
  await writeFile(join(topics, "missing.md"), "zzzmissingtoken ADDED_AFTER_FIRST_TURN\n")
  assert.equal((await prompt(empty, "Investigate zzzmissingtoken boundary behavior again.")).memory, "")
  scenarios.push("empty-attempt-stable")
  await runtime.api("/instance/dispose", undefined, "POST")
  assert.match(
    (await prompt(empty, "Investigate zzzmissingtoken boundary behavior again.")).memory,
    /ADDED_AFTER_FIRST_TURN/,
  )
  scenarios.push("empty-resume-retries-search")
  await writeFile(join(topics, "project.md"), "project conventions preferences architecture GREETING_CONTEXT\n")
  assert.match((await prompt(await create(), "Hello!")).memory, /GREETING_CONTEXT/)
  scenarios.push("greeting-fallback")
  await writeFile(join(topics, "unicode.md"), `数据库连接池配置 ${"😀".repeat(600)} END_MUST_BE_TRUNCATED\n`)
  const unicode = (await prompt(await create(), "检查数据库连接池配置的问题")).memory
  assert.match(unicode, /数据库连接池配置/)
  assert.ok(!unicode.includes("�") && !unicode.includes("END_MUST_BE_TRUNCATED"))
  assert.match(unicode, /\.\.\./)
  scenarios.push("unicode-and-snippet-limit")
  for (let i = 0; i < 8; i++) await writeFile(join(topics, `bounded-${i}.md`), "boundedtoken SAME_RANK_CONTENT\n")
  const bounded = await create()
  assert.equal(
    (await prompt(bounded, "Please search for boundedtoken records.")).memory.match(/### Result /g).length,
    6,
  )
  await runtime.api(`/session/${bounded}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  assert.equal((await prompt(bounded, "Continue the investigation.")).memory.match(/### Result /g).length, 3)
  scenarios.push("first-six-compaction-three")
  const external = join(runtime.directory, "external.md")
  await writeFile(external, "symlinksecret OUTSIDE_CONTEXT_SECRET\n")
  await symlink(external, join(topics, "linked.md"))
  assert.equal((await prompt(await create(), "Please look for symlinksecret records.")).memory, "")
  await rm(join(topics, "linked.md"))
  scenarios.push("symlink-excluded")
  await configure({ initial_injection: { enabled: true, min_score: 2 } })
  assert.equal((await prompt(await create(), "Investigate database transaction retry boundaries.")).memory, "")
  scenarios.push("configured-score-threshold")
  await configure({ initial_injection: { enabled: false } })
  const disabled = await create()
  assert.equal((await prompt(disabled, "Investigate database transaction retry boundaries.")).memory, "")
  await runtime.api(`/session/${disabled}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  assert.match((await prompt(disabled, "Continue the investigation.")).memory, /COMPACTED_DATABASE_CONTEXT/)
  scenarios.push("initial-disabled-compaction-enabled")
  await configure({ enabled: false })
  assert.equal((await prompt(disabled, "Investigate database transaction retry boundaries.")).memory, "")
  scenarios.push("memory-disabled")
  console.log(JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", scenarios, output: runtime.output }))
} finally {
  await writeFile(join(runtime.output, "memory-context.json"), JSON.stringify({ scenarios, requests }, null, 2))
  await runtime.close()
}
