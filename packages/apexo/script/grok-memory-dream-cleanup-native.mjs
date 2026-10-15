// Native legacy Dream through the real CLI or rebuilt Desktop backend.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, utimes } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { MemoryDream } from "@apexo/core/memory-dream"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const changed = process.argv.includes("--recreated")
const foreign = process.argv.includes("--foreign")
const absent = process.argv.includes("--absent")
const stage = process.argv.find((arg) => arg.startsWith("--crash="))?.slice(8)
const calls = []
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  ...(stage
    ? {
        env: { LEGACY_DREAM_CRASH_STAGE: stage },
        bunArgs: ["--preload", fileURLToPath(new URL("./grok-memory-legacy-dream-crash-preload.mjs", import.meta.url))],
      }
    : {}),
  next({ body }) {
    const messages = body.messages ?? body.input ?? []
    const system = [
      body.instructions ?? "",
      ...messages
        .filter((message) => ["system", "developer"].includes(message.role))
        .map((message) =>
          typeof message.content === "string"
            ? message.content
            : message.content.map((part) => part.text ?? "").join(""),
        ),
    ].join("\n")
    assert.match(system, /You are a memory assistant consolidating session logs/)
    assert.deepEqual(body.tools ?? [], [])
    const user = messages.findLast((message) => message.role === "user")
    const text = typeof user.content === "string" ? user.content : user.content.map((part) => part.text ?? "").join("")
    assert.match(text, /LEGACY_DREAM_SOURCE/)
    assert.match(text, /PRIOR_MEMORY_FACT/)
    assert.ok(!text.includes("CURRENT_SESSION_EXCLUDED"))
    calls.push({ system, text })
    return { content: "## Durable knowledge\nPRIOR_MEMORY_FACT and LEGACY_DREAM_SOURCE remain useful." }
  },
})
const results = []
const request = async (route, body, method = body === undefined ? "GET" : "POST", expected = 200) => {
  const response = await fetch(new URL(route, runtime.url), {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  assert.equal(response.status, expected, `${route}: ${text}`)
  return text ? JSON.parse(text) : undefined
}
const settled = (root, id) =>
  poll(
    async () => {
      const info = await request(`${root}/operation/${id}`)
      return info.state === "finished" ? info : undefined
    },
    "legacy Dream settlement",
    20000,
  )
try {
  const baseURL = JSON.parse(runtime.env.APEXO_CONFIG_CONTENT).provider.xai.options.baseURL
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      memory: { enabled: true, dream: { enabled: false } },
      memory_v2: { enabled: false },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        xai: {
          api: { type: "aisdk", package: "@ai-sdk/xai", url: baseURL, settings: { apiKey: "fixture" } },
          models: {
            "grok-4.7": {
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const session = (
    await request("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const root = `/api/session/${session.id}/memory`
  const empty = `mop_${randomUUID()}`
  await request(`${root}/dream`, { id: empty })
  assert.equal((await settled(root, empty)).result.status, "no_work")
  assert.equal(calls.length, 0)
  results.push("native empty legacy Dream settles without provider")
  const files = MemoryDream.paths({ directory: runtime.directory, home: runtime.env.APEXO_TEST_HOME })
  await mkdir(files.sessions, { recursive: true })
  await writeFile(files.file, "## Prior knowledge\nPRIOR_MEMORY_FACT")
  await writeFile(join(files.sessions, "2026-10-15-other.md"), "## Durable source\nLEGACY_DREAM_SOURCE")
  await utimes(join(files.sessions, "2026-10-15-other.md"), new Date(0), new Date(0))
  await writeFile(join(files.sessions, `2026-10-15-${session.id}.md`), "CURRENT_SESSION_EXCLUDED")
  const original = `mop_${randomUUID()}`
  await request(`${root}/dream`, { id: original })
  if (stage) {
    await poll(
      () => Bun.file(join(runtime.env.XDG_STATE_HOME, "legacy-dream-crash-checkpoint")).exists(),
      `publication ${stage} checkpoint`,
      20000,
    )
    assert.equal(calls.length, 1)
    assert.equal(await Bun.file(join(files.sessions, "2026-10-15-other.md")).exists(), true)
    assert.match(await readFile(files.file, "utf8"), /apexo-native-dream:/)
    assert.match(await readFile(files.state, "utf8"), /native/)
    await runtime.crash()
    await runtime.reopen()
    assert.equal((await request(`${root}/operation/${original}`)).ownership, "unverified")
    await request(`${root}/dream`, { id: original })
    await request(`${root}/operation`)
    assert.equal(calls.length, 1)
    assert.equal(await Bun.file(join(files.sessions, "2026-10-15-other.md")).exists(), true)
    results.push(`${stage} process death leaves source and passive status without provider replay`)
    if (changed) await writeFile(join(files.sessions, "2026-10-15-other.md"), "RECREATED_SOURCE_MUST_SURVIVE")
    if (foreign) await writeFile(files.file, "## Foreign\nFOREIGN_DESTINATION_MUST_SURVIVE")
  } else {
    assert.equal((await settled(root, original)).result.status, "completed")
    assert.equal(calls.length, 1)
    results.push("manual native Dream publishes prior and other Session knowledge with no tools")
  }
  const retry = `mop_${randomUUID()}`
  await request(`${root}/dream`, { id: retry, retryOf: original })
  assert.equal((await settled(root, retry)).result.status, foreign ? "failed" : "completed")
  assert.equal(await Bun.file(join(files.sessions, "2026-10-15-other.md")).exists(), foreign || changed || absent)
  assert.equal(await Bun.file(join(files.sessions, `2026-10-15-${session.id}.md`)).exists(), true)
  if (changed)
    assert.equal(await readFile(join(files.sessions, "2026-10-15-other.md"), "utf8"), "RECREATED_SOURCE_MUST_SURVIVE")
  if (foreign) {
    assert.equal(await readFile(files.file, "utf8"), "## Foreign\nFOREIGN_DESTINATION_MUST_SURVIVE")
    assert.equal(calls.length, 1)
    console.log(
      JSON.stringify({
        result: "pass",
        stage,
        foreign,
        checks: ["passive-crash-retains-source", "foreign-publication-refuses-cleanup", "no-provider-replay"],
        providerCalls: calls.length,
        output: runtime.output,
      }),
    )
    process.exitCode = 0
  } else {
    assert.equal(calls.length, 1)
    const output = await readFile(files.file, "utf8")
    assert.match(output, /PRIOR_MEMORY_FACT and LEGACY_DREAM_SOURCE/)
    assert.match(output, new RegExp(original))
    results.push(
      absent
        ? "before-feature-source-retained"
        : changed
          ? "explicit-recovery-retains-recreated-source"
          : "explicit-recovery-deletes-only-exact-old-consumed-source",
    )
    await writeFile(files.file, "## Foreign update\nMust remain unchanged")
    const denied = `mop_${randomUUID()}`
    await request(`${root}/dream`, { id: denied, retryOf: retry })
    assert.equal((await settled(root, denied)).result.status, "failed")
    assert.equal(await readFile(files.file, "utf8"), "## Foreign update\nMust remain unchanged")
    assert.equal(calls.length, 1)
    results.push("foreign actual bytes fail closed without overwrite or provider")
    console.log(
      JSON.stringify({
        result: "pass",
        runtime: process.argv[2] ?? "cli",
        stage,
        results,
        providerCalls: calls.length,
        output: runtime.output,
      }),
    )
  }
} finally {
  await runtime.close()
}
