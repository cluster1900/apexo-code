import assert from "node:assert/strict"
import { readFile, readdir, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const kind = process.argv[2] ?? "cli"
const compact = process.argv.includes("--compact")
const calls = [],
  checks = []
const planned = { hold: undefined, invalid: false, extract: false }
const runtime = await startShellFixture(kind, {
  config: {
    memory_v2: { enabled: true, compact_index_enabled: compact },
    memory: { enabled: true, dream: { enabled: true, check_interval_secs: 1 } },
    compaction: { auto: false, memory_flush: { enabled: false } },
  },
  async next({ body, input }) {
    if (JSON.stringify(input).includes("You extract durable memory observations"))
      return {
        content: JSON.stringify(
          planned.extract
            ? {
                outcome: "observations",
                observations: [{ type: "project", statement: "CAPTURED_DREAM_FACT use bounded retries" }],
              }
            : { outcome: "noop", observations: [] },
        ),
      }
    if (!JSON.stringify(input).includes("Consolidate durable memory observations into topic Markdown"))
      return { content: "DREAM_V2_ACK" }
    const message = input.findLast((item) => item.role === "user").content
    const value = JSON.parse(typeof message === "string" ? message : message.map((part) => part.text ?? "").join(""))
    const invalid = planned.invalid
    calls.push({
      input: value,
      tools: body.tools ?? [],
      schema: body.response_format ?? body.text?.format,
      model: body.model,
    })
    if (planned.hold) await planned.hold.promise
    return {
      content: JSON.stringify({
        operations: invalid
          ? []
          : ["decisions", "testing"].map((name) => ({
              action: value.topics.some((topic) => topic.path === `topics/${name}.md`) ? "update" : "create",
              path: `topics/${name}.md`,
              content: `# ${name}\nDREAM_V2_CANONICAL: preserve WAL and use bounded retries.`,
              evidence: value.observations.slice(0, 64).map((note) => note.path),
            })),
      }),
    }
  },
})
const endpoint = (id) => `/experimental/session/${id}/memory`
const create = async (extra = {}) => (await runtime.api("/session", { title: "V2 Dream parity", ...extra })).id
const save = (id, content, scope = "workspace") => runtime.api(`${endpoint(id)}/remember`, { content, scope })
const list = (id) => runtime.api(endpoint(id))
const start = (id, kind = "dream") => runtime.api(`${endpoint(id)}/operation`, { kind })
const operation = (id) => runtime.api(`${endpoint(id)}/operation`)
const finish = (id) =>
  poll(
    async () => {
      const value = await operation(id)
      return value?.state === "finished" && value.result
    },
    "V2 Dream completed",
    30_000,
  )
const configure = (settings) =>
  runtime.api(
    "/config",
    { memory_v2: { enabled: true, compact_index_enabled: compact, automatic_dream_enabled: false, ...settings } },
    "PATCH",
  )
const hold = () => {
  const value = Promise.withResolvers()
  planned.hold = value
  return value
}
const prompt = (id) =>
  runtime.api(`/session/${id}/message`, {
    model: { providerID: "xai", modelID: "grok-4.7" },
    parts: [{ type: "text", text: "Remember the durable retry rule for this project." }],
  })
try {
  // Mutable flags live in the project file; fixture environment configuration has higher precedence.
  await configure({})
  const id = await create()
  await start(id)
  assert.equal((await finish(id)).status, "no_work")
  assert.equal(calls.length, 0)
  checks.push("empty-dream-no-model-call")
  const global = await save(id, "GLOBAL_PREFERENCE must remain global", "global")
  const note = await save(id, "PROJECT_FACT use SQLite WAL")
  const root = dirname(dirname(dirname(note.path)))
  const before = await runtime.api(`/session/${id}/message`)
  await start(id)
  const completed = await finish(id)
  assert.equal(completed.status, "completed")
  assert.equal(completed.processed, 1)
  assert.equal(completed.topics, 2)
  assert.equal(completed.cleaned, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].tools.length, 0)
  assert.ok(JSON.stringify(calls[0].schema).includes("operations"))
  assert.equal(calls[0].input.observations.length, 1)
  assert.ok(!JSON.stringify(calls[0].input).includes("GLOBAL_PREFERENCE"))
  assert.ok((await list(id)).some((item) => item.path === global.path))
  assert.equal((await readdir(join(root, "archive"))).length, 1)
  assert.equal((await readdir(join(root, "topics"))).length, 2)
  assert.match(await readFile(join(root, "MEMORY.md"), "utf8"), /topics\/decisions.md/)
  if (compact)
    assert.doesNotMatch(await readFile(join(root, "MEMORY.md"), "utf8"), /DREAM_V2_CANONICAL|Pending observations/)
  assert.deepEqual(await runtime.api(`/session/${id}/message`), before)
  checks.push(
    "manual-two-topic-plan-and-counts",
    "strict-schema-no-tools",
    "workspace-global-isolation",
    "archive-and-manifest-convergence",
    "no-main-session-messages",
  )
  await start(id)
  assert.equal((await finish(id)).status, "no_work")
  assert.equal(calls.length, 1)
  checks.push("repeat-dream-does-not-reconsume")
  await save(id, "RETRY_ON_INVALID_OUTPUT")
  planned.invalid = true
  await start(id)
  assert.equal((await finish(id)).status, "failed")
  assert.equal((await list(id)).filter((row) => row.name.startsWith("observations/")).length, 2)
  planned.invalid = false
  await start(id)
  assert.equal((await finish(id)).status, "completed")
  checks.push("invalid-plan-keeps-observation-and-releases-lease")
  const edited = await save(id, "BEFORE_EXTERNAL_EDIT")
  const editing = hold()
  const editCalls = calls.length
  await start(id)
  await poll(() => calls.length > editCalls, "Dream inference started")
  await writeFile(edited.path, "AFTER_EXTERNAL_EDIT")
  editing.resolve()
  planned.hold = undefined
  assert.equal((await finish(id)).status, "conflict")
  assert.equal(await readFile(edited.path, "utf8"), "AFTER_EXTERNAL_EDIT")
  checks.push("external-edit-preserved")
  const cancelled = hold()
  const cancelCalls = calls.length
  const active = await start(id)
  await poll(() => calls.length > cancelCalls, "cancellable Dream started")
  assert.equal((await start(id)).id, active.id)
  await runtime.api(`${endpoint(id)}/operation/cancel`, { id: active.id })
  assert.equal((await finish(id)).status, "cancelled")
  cancelled.resolve()
  planned.hold = undefined
  await start(id)
  assert.equal((await finish(id)).status, "completed")
  checks.push("cancel-retry-and-single-operation")
  const disabledNote = await save(id, "DISABLED_RESULT_MUST_NOT_PUBLISH")
  const disabling = hold()
  const disabledCalls = calls.length
  await start(id)
  await poll(() => calls.length > disabledCalls, "Dream before disabling")
  await runtime.api(`${endpoint(id)}/toggle`, { enabled: false })
  disabling.resolve()
  planned.hold = undefined
  assert.equal((await finish(id)).status, "disabled")
  assert.ok(await readFile(disabledNote.path, "utf8"))
  await runtime.api(`${endpoint(id)}/toggle`, { enabled: true })
  await start(id)
  assert.equal((await finish(id)).status, "completed")
  checks.push("session-off-fences-model-result")
  await configure({ manual_dream_enabled: false })
  await start(id)
  assert.equal((await finish(id)).status, "disabled")
  await configure({ manual_dream_enabled: true })
  const denied = await create({ permission: [{ permission: "edit", pattern: "*", action: "deny" }] })
  await start(denied)
  assert.equal((await finish(denied)).status, "denied")
  checks.push("manual-kill-switch", "permission-denial")
  planned.extract = true
  await configure({ rollout: "shadow" })
  const shadow = await create()
  await prompt(shadow)
  await start(shadow, "flush")
  assert.equal((await finish(shadow)).status, "completed")
  const topicsBefore = await readFile(join(root, "topics/decisions.md"), "utf8")
  const archiveBefore = await readdir(join(root, "archive"))
  await start(shadow)
  const evaluated = await finish(shadow)
  assert.equal(evaluated.status, "shadow")
  assert.equal(evaluated.processed, 1)
  assert.equal(evaluated.topics, 2)
  assert.equal(evaluated.cleaned, 0)
  assert.equal(await readFile(join(root, "topics/decisions.md"), "utf8"), topicsBefore)
  assert.deepEqual(await readdir(join(root, "archive")), archiveBefore)
  await start(shadow)
  assert.equal((await finish(shadow)).status, "no_work")
  checks.push("shadow-validates-without-publication", "shadow-evaluation-deduplicates")
  await configure({ rollout: "record_only" })
  const recording = await create()
  await start(recording)
  assert.equal((await finish(recording)).status, "disabled")
  checks.push("record-only-never-consolidates")
  planned.extract = false
  await configure({ rollout: "active", automatic_dream_enabled: true })
  const automatic = await create()
  const autoCalls = calls.length
  for (let n = 0; n < 19; n++) await save(automatic, `AUTOMATIC_FACT_${n}`)
  assert.equal(calls.length, autoCalls)
  await save(automatic, "AUTOMATIC_FACT_19")
  await poll(() => calls.length === autoCalls + 1, "automatic twenty-observation threshold", 30_000)
  await poll(
    async () =>
      (await list(automatic)).filter((row) => row.source === "workspace" && row.name.startsWith("observations/"))
        .length === 0,
    "automatic archive",
    30_000,
  )
  assert.equal(calls.at(-1).input.observations.length, 20)
  checks.push("automatic-count-threshold")
  await configure({ rollout: "active" })
  const aged = await save(automatic, "AGED_PENDING_OBSERVATION")
  await utimes(aged.path, new Date(1), new Date(1))
  await configure({ rollout: "active", automatic_dream_enabled: true })
  const ageCalls = calls.length
  await save(automatic, "FRESH_TRIGGER")
  await poll(() => calls.length > ageCalls, "automatic age threshold", 30_000)
  await poll(
    async () =>
      (await list(automatic)).filter((row) => row.source === "workspace" && row.name.startsWith("observations/"))
        .length === 0,
    "aged notes archived",
    30_000,
  )
  checks.push("automatic-age-threshold")
  const coalesced = hold()
  const coalescedCalls = calls.length
  for (let n = 0; n < 20; n++) await save(automatic, `FIRST_BATCH_${n}`)
  await poll(() => calls.length === coalescedCalls + 1, "first automatic batch")
  for (let n = 0; n < 20; n++) await save(automatic, `ARRIVING_BATCH_${n}`)
  assert.equal(calls.length, coalescedCalls + 1)
  assert.equal(calls.at(-1).input.observations.length, 20)
  coalesced.resolve()
  planned.hold = undefined
  await poll(() => calls.length === coalescedCalls + 2, "coalesced next batch", 30_000)
  await poll(
    async () =>
      (await list(automatic)).filter((row) => row.source === "workspace" && row.name.startsWith("observations/"))
        .length === 0,
    "both batches archived",
    30_000,
  )
  assert.equal(calls.at(-1).input.observations.length, 20)
  checks.push("automatic-single-flight-and-coalesced-arrivals")
  await configure({ rollout: "active" })
  for (let n = 0; n < 19; n++) await save(automatic, `BEFORE_CAPTURE_${n}`)
  const captureCalls = calls.length
  await configure({ rollout: "active", automatic_dream_enabled: true })
  planned.extract = true
  await prompt(automatic)
  await start(automatic, "flush")
  assert.equal((await finish(automatic)).status, "completed")
  await poll(() => calls.length === captureCalls + 1, "capture completion schedules Dream", 30_000)
  await poll(
    async () =>
      (await list(automatic)).filter((row) => row.source === "workspace" && row.name.startsWith("observations/"))
        .length === 0,
    "captured threshold archived",
    30_000,
  )
  assert.equal(calls.at(-1).input.observations.length, 20)
  planned.extract = false
  checks.push("capture-completion-triggers-automatic-dream")
  await configure({ capture_enabled: false })
  for (let n = 0; n < 20; n++) await save(automatic, `RESUME_WITHOUT_CAPTURE_${n}`)
  const resumeCalls = calls.length
  await configure({ capture_enabled: false, automatic_dream_enabled: true })
  await runtime.api(`${endpoint(automatic)}/status`)
  await poll(() => calls.length === resumeCalls + 1, "resume automatic Dream with capture disabled", 30_000)
  await poll(
    async () =>
      (await list(automatic)).filter((row) => row.source === "workspace" && row.name.startsWith("observations/"))
        .length === 0,
    "resumed pending observations archived",
    30_000,
  )
  checks.push("session-open-resumes-dream-independently-of-capture")
  const periodicCalls = calls.length
  const waiting = await save(automatic, "PERIODIC_AGE_CHECK_WITHOUT_NEW_WAKE")
  // Leave the young note through two real timer ticks, then age only its file.
  // No subsequent status/read/write request may be the wake that starts Dream.
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(calls.length, periodicCalls)
  await utimes(waiting.path, new Date(1), new Date(1))
  await poll(() => calls.length === periodicCalls + 1, "periodic Dream age check", 5000)
  await poll(
    async () =>
      (await list(automatic)).filter((row) => row.source === "workspace" && row.name.startsWith("observations/"))
        .length === 0,
    "periodic observation archived",
    30_000,
  )
  checks.push("periodic-age-check-without-new-session-wake")
  await configure({ file_writes_enabled: false })
  await start(automatic)
  assert.equal((await finish(automatic)).status, "disabled")
  checks.push("file-writes-kill-switch")
  console.log(
    JSON.stringify({ kind, passed: checks.length, checks, calls: calls.length, output: runtime.output }, null, 2),
  )
} finally {
  planned.hold?.resolve()
  await writeFile(join(runtime.output, "memory-v2-dream.json"), JSON.stringify({ checks, calls }, null, 2))
  await runtime.close()
  console.error(`V2 Dream evidence: ${runtime.output}`)
}
