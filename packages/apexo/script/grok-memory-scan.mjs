import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const checks = [],
  contexts = []
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: { enabled: true, capture_enabled: false, automatic_dream_enabled: false },
    memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  next({ input, ancillary }) {
    if (!ancillary) contexts.push(JSON.stringify(input.filter((item) => item.role === "system")))
    return { content: "MEMORY_SCAN_ACK" }
  },
})
try {
  const id = (await runtime.api("/session", { title: "Memory scan boundaries" })).id
  const endpoint = `/experimental/session/${id}/memory`
  const first = await runtime.api(`${endpoint}/remember`, { content: "# First note", scope: "workspace" })
  const root = dirname(dirname(dirname(first.path)))
  const seed = async (from, through) => {
    for (let start = from; start < through; start += 128)
      await Promise.all(
        Array.from({ length: Math.min(128, through - start) }, (_, offset) => {
          const name = String(start + offset).padStart(5, "0")
          return writeFile(join(root, "topics", `scan-${name}.md`), `# SCAN_${name}\nSaved topic\n`)
        }),
      )
  }
  await seed(0, 4097)
  const second = await runtime.api(`${endpoint}/remember`, { content: "# Second note", scope: "workspace" })
  const initial = await runtime.api(endpoint)
  assert.equal(initial.filter((item) => item.name.startsWith("topics/")).length, 4097)
  assert.ok(initial.some((item) => item.path === second.path))
  checks.push("more-than-4096-topics", "manual-save-reconciles-large-scope")
  console.error(`${kind}: 4097 topics recovered and listed`)
  const reply = await runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Inspect the saved project topics." }],
  })
  assert.ok(!reply.info?.error, JSON.stringify(reply.info?.error))
  assert.match(contexts.at(-1), /SCAN_00000/)
  assert.ok(Buffer.byteLength(await readFile(join(root, "MEMORY.md"), "utf8")) <= 8192)
  checks.push("large-scope-context", "manifest-budget-preserved")
  await seed(4097, 10001)
  const capped = await runtime.api(endpoint)
  assert.equal(capped.length, 10000)
  assert.equal(capped[0].name, "MEMORY.md")
  assert.equal(capped[1].name, "topics/scan-00000.md")
  assert.equal(capped.at(-1).name, "topics/scan-09998.md")
  assert.equal((await readdir(join(root, "topics"))).length, 10001)
  checks.push(
    "10000-file-list-cap",
    "generated-index-preserved-at-cap",
    "stable-topic-selection",
    "omitted-files-preserved",
  )
  console.error(`${kind}: 10001 files bounded to 10000 visible entries`)
  await writeFile(join(root, "archive", "old.md"), "# Archived")
  const result = await promisify(execFile)("bun", [resolve("src/index.ts"), "memory", "clear", "--yes"], {
    cwd: runtime.directory,
    env: runtime.env,
    timeout: 120000,
  })
  assert.match(result.stdout, /Cleared/i)
  assert.deepEqual(await readdir(join(root, "topics")), [])
  assert.deepEqual(await readdir(join(root, "archive")), [])
  assert.deepEqual(await readdir(join(root, "observations/_inbox")), [])
  assert.deepEqual(await runtime.api(endpoint), [])
  checks.push("clear-includes-files-omitted-from-list", "clear-batches-more-than-10000-tombstones", "empty-after-clear")
  console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }, null, 2))
} finally {
  await writeFile(join(runtime.output, "memory-scan.json"), JSON.stringify({ checks }, null, 2))
  await runtime.close()
  console.error(`Memory scan evidence: ${runtime.output}`)
}
