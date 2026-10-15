import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const compact = process.argv.includes("--compact")
const checks = [],
  contexts = []
const planned = { path: "" }
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: {
      enabled: true,
      compact_index_enabled: compact,
      capture_enabled: false,
      automatic_dream_enabled: false,
    },
    memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  next({ input, ancillary, finished }) {
    if (ancillary) return { content: "MANIFEST_COMPACTION_SUMMARY" }
    const system = input
      .filter((item) => item.role === "system")
      .map((item) =>
        typeof item.content === "string" ? item.content : item.content.map((part) => part.text ?? "").join("\n"),
      )
      .join("\n")
    contexts.push(system.match(/<memory-context>[\s\S]*?<\/memory-context>/)?.[0] ?? "")
    if (planned.path && !finished) return { tool: "read_file", args: { target_file: planned.path, limit: 2 } }
    return { content: "MANIFEST_ACK" }
  },
})
const endpoint = (id) => `/experimental/session/${id}/memory`
const create = async (extra = {}) => (await runtime.api("/session", { title: "Memory manifest parity", ...extra })).id
const prompt = async (id) => {
  const before = contexts.length
  const result = await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: planned.path ? "Read the selected saved topic." : "Inspect saved memory." }],
  })
  assert.ok(contexts.length > before)
  assert.ok(!result.info?.error, JSON.stringify(result.info?.error))
  return contexts.at(-1)
}
try {
  const empty = await prompt(await create())
  assert.match(empty, /# Global memory index/)
  assert.match(empty, /# Workspace memory index/)
  assert.match(empty, compact ? /No topics have been recorded yet/ : /No memory files have been recorded yet/)
  checks.push("both-empty-manifests")
  const id = await create()
  const note = await runtime.api(`${endpoint(id)}/remember`, {
    content: "# OBSERVATION_TITLE\nOBSERVATION_BODY",
    scope: "workspace",
  })
  const root = dirname(dirname(dirname(note.path)))
  await Promise.all(
    Array.from({ length: 200 }, (_, i) =>
      writeFile(
        join(root, "topics", `topic-${String(i).padStart(3, "0")}.md`),
        `# Topic ${String(i).padStart(3, "0")}\nTOPIC_DESCRIPTION_${i}\n`,
      ),
    ),
  )
  const initial = await prompt(id)
  const disk = await readFile(join(root, "MEMORY.md"), "utf8")
  assert.ok(initial.includes(disk))
  assert.ok(Buffer.byteLength(disk) <= 8192)
  assert.doesNotMatch(disk, /OBSERVATION_BODY/)
  if (compact) {
    assert.match(disk, /## More topics/)
    assert.doesNotMatch(disk, /OBSERVATION_TITLE|TOPIC_DESCRIPTION|Pending observations/)
    assert.equal(
      (disk.match(/\*\*Topic/g) ?? []).length +
        disk.split("By file name under `topics/`: ")[1].trim().split(", ").length,
      200,
    )
  } else {
    assert.match(disk, /TOPIC_DESCRIPTION_0/)
    assert.equal((disk.match(/\*\*Topic/g) ?? []).length, 64)
  }
  checks.push(
    "disk-matches-injected-scope",
    "utf8-byte-budget",
    compact ? "compact-titles-and-slugs" : "standard-descriptions-entry-cap",
  )
  const target = join(root, "topics", "topic-199.md")
  const preview = await fetch(
    `${runtime.url}${endpoint(id)}/note?${new URLSearchParams({ directory: runtime.directory, path: target })}`,
  )
  assert.ok(preview.ok, await preview.clone().text())
  assert.match((await preview.json()).content, /Topic 199/)
  assert.equal(await prompt(id), initial)
  assert.equal(
    (await runtime.api(endpoint(id))).find((note) => note.name.startsWith("topics/"))?.name,
    "topics/topic-000.md",
  )
  checks.push("preview-does-not-rank", "prefix-stays-stable")
  planned.path = target
  await prompt(id)
  planned.path = ""
  const messages = await runtime.api(`/session/${id}/message`)
  assert.ok(
    messages
      .flatMap((message) => message.parts)
      .some(
        (part) =>
          part.type === "tool" &&
          part.tool === "read_file" &&
          part.state.status === "completed" &&
          part.state.output.includes("Topic 199"),
      ),
  )
  assert.equal(await prompt(id), initial)
  const fresh = await prompt(await create())
  const refreshed = await readFile(join(root, "MEMORY.md"), "utf8")
  assert.ok(fresh.includes(refreshed))
  assert.equal(
    (await runtime.api(endpoint(id))).find((note) => note.name.startsWith("topics/"))?.name,
    compact ? "topics/topic-199.md" : "topics/topic-000.md",
  )
  assert.ok(
    refreshed.indexOf(compact ? "**Topic 199**" : "**Topic 000**") <
      refreshed.indexOf(compact ? "**Topic 000**" : "**Topic 001**"),
  )
  checks.push(
    "ordinary-model-read",
    "read-keeps-existing-prefix",
    compact ? "new-session-uses-read-ranking" : "standard-keeps-alphabetical-order",
    "browser-matches-ranking",
  )
  await runtime.api(`/session/${id}/summarize`, { providerID: "xai", modelID: "grok-4.7", auto: false })
  assert.ok((await prompt(id)).includes(refreshed))
  checks.push("compaction-refreshes-manifest")
  const denied = await create({ permission: [{ permission: "read", pattern: target, action: "deny" }] })
  const filtered = await prompt(denied)
  assert.doesNotMatch(filtered, /Topic 199|topic-199/)
  assert.equal(await readFile(join(root, "MEMORY.md"), "utf8"), refreshed)
  checks.push("denied-topic-excluded", "filtered-view-preserves-shared-disk")
  await runtime.api(`${endpoint(id)}/remember`, {
    content: "# LATER_OBSERVATION\nNo body injection",
    scope: "workspace",
  })
  const afterSave = await readFile(join(root, "MEMORY.md"), "utf8")
  if (compact) {
    assert.doesNotMatch(afterSave, /LATER_OBSERVATION|TOPIC_DESCRIPTION/)
    assert.ok(afterSave.indexOf("**Topic 199**") < afterSave.indexOf("**Topic 000**"))
  } else assert.match(afterSave, /TOPIC_DESCRIPTION_0/)
  checks.push("writer-preserves-configured-budget")
  console.log(JSON.stringify({ kind, compact, passed: checks.length, checks, output: runtime.output }, null, 2))
} finally {
  await writeFile(join(runtime.output, "memory-manifest.json"), JSON.stringify({ checks, contexts }, null, 2))
  await runtime.close()
  console.error(`Memory manifest evidence: ${runtime.output}`)
}
