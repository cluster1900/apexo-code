// Storage-level process parity: Bun CLI and Electron's embedded Node/SQLite.
// This does not claim that the V2 session/UI integration is already complete.
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { MemoryCapture } from "@apexo/core/memory-capture"

await run()

async function run() {
  if (process.argv[2] === "worker") return worker()
  const mode = process.argv[2] ?? "cli"
  assert.ok(["cli", "desktop"].includes(mode))
  const output = await mkdtemp(join(tmpdir(), `apexo-memory-capture-${mode}-`))
  const home = join(output, "home")
  await mkdir(home)
  const built = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.url)],
    target: mode === "desktop" ? "node" : "bun",
    format: "esm",
    outdir: join(output, "build"),
  })
  assert.equal(built.success, true, built.logs.map(String).join("\n"))
  const engine =
    mode === "cli"
      ? process.execPath
      : resolve(
          "../desktop/node_modules/electron/dist",
          (await readFile("../desktop/node_modules/electron/path.txt", "utf8")).trim(),
        )
  const children = new Set()
  const evidence = []
  const checks = []
  const spawn = (step, session, extra = {}) => {
    const child = Bun.spawn([engine, built.outputs[0].path, "worker", home, step, session, JSON.stringify(extra)], {
      env: { ...process.env, ...(mode === "desktop" ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      stdout: "pipe",
      stderr: "pipe",
    })
    children.add(child)
    return child
  }
  const finish = async (child) => {
    const result = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    children.delete(child)
    evidence.push({ stdout: result[0], stderr: result[1], code: result[2] })
    assert.equal(result[2], 0, result[1])
    return JSON.parse(result[0])
  }
  const call = (step, session, extra) => finish(spawn(step, session, extra))
  const park = async (step, session) => {
    const child = spawn(step, session)
    const reader = child.stdout.getReader()
    const state = { text: "" }
    const ready = async () => {
      while (!state.text.includes("\n")) {
        const value = await reader.read()
        if (value.done) throw new Error(`Worker exited before readiness: ${state.text}`)
        state.text += new TextDecoder().decode(value.value)
      }
      return JSON.parse(state.text.split("\n")[0])
    }
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000)
    const result = await ready().finally(() => clearTimeout(timeout))
    child.kill("SIGKILL")
    await child.exited
    children.delete(child)
    evidence.push({ phase: step, result, killed: true })
    return result
  }
  try {
    const admitted = await call("seed", "lease")
    assert.equal(admitted.jobs.length, 1)
    assert.deepEqual(admitted.cursors, { requested: 1, captured: 0, indexed: 0 })
    checks.push("durable-idempotent-enqueue")
    const killed = await park("park", "lease")
    assert.equal(killed.lease.job.attempt, 1)
    const locked = await call("claim", "lease", { now: 5999 })
    assert.equal(locked.lease, null)
    checks.push("killed-worker-lease-persists")
    const recovered = await call("finish", "lease", { now: 6000 })
    assert.equal(recovered.lease.job.attempt, 2)
    assert.deepEqual(recovered.cursors, { requested: 1, captured: 1, indexed: 1 })
    checks.push("expired-lease-reclaimed", "reclaimed-worker-commits")
    const reopened = await call("inspect", "lease")
    assert.equal(reopened.matches.length, 1)
    assert.equal(reopened.jobs[0].status, "completed")
    checks.push("process-reopen-index-and-state")
    await call("seed", "claim-race")
    const contenders = await Promise.all([
      finish(spawn("claim", "claim-race", { owner: "a" })),
      finish(spawn("claim", "claim-race", { owner: "b" })),
    ])
    assert.equal(contenders.filter((result) => result.lease).length, 1)
    checks.push("cross-process-exclusive-claim")
    for (const step of ["journal-crash", "manifest-crash"]) {
      await call("seed", step)
      const crashed = await park(step, step)
      assert.equal(crashed.status, "publishing")
      assert.deepEqual(crashed.cursors, { requested: 1, captured: 1, indexed: 0 })
      await rm(crashed.obstructed, { recursive: true })
      await rename(`${crashed.obstructed}.parked`, crashed.obstructed)
      const repaired = await call("inspect", step)
      assert.equal(repaired.matches.length, 1)
      assert.equal(repaired.jobs[0].attempt, 1)
      assert.equal(repaired.jobs[0].status, "completed")
      assert.deepEqual(repaired.cursors, { requested: 1, captured: 1, indexed: 1 })
      assert.equal((await call("inspect", "lease")).matches.length, 1)
      checks.push(
        step === "journal-crash" ? "journal-recovers-without-reextracting" : "published-files-converge-after-crash",
      )
    }
    checks.push("pre-existing-notes-survive-recovery")
    await rm(recovered.files[0])
    const deleted = await call("inspect", "lease")
    assert.equal(deleted.matches.length, 0)
    assert.equal(
      (await readdir(join(deleted.root, "observations/_inbox"))).includes(recovered.files[0].split("/").at(-1)),
      false,
    )
    checks.push("deleted-note-stays-deleted")
    console.log(
      JSON.stringify(
        {
          mode,
          scope: "V2 capture storage and actual runtime processes; session integration pending",
          passed: checks.length,
          checks,
          output,
        },
        null,
        2,
      ),
    )
  } finally {
    for (const child of children) child.kill("SIGKILL")
    await Promise.all([...children].map((child) => child.exited))
    await writeFile(join(output, "evidence.json"), JSON.stringify({ checks, evidence }, null, 2))
    console.error(`Memory capture evidence: ${output}`)
  }
}

async function worker() {
  const home = process.argv[3]
  const step = process.argv[4]
  const session = process.argv[5]
  const extra = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(process.argv[6])
  const now = extra.now ?? 1000
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const memory = yield* MemoryCapture.make({ home, directory: home, projectID: "process-parity" })
        const result = { root: memory.root.path, runtime: process.versions }
        if (step === "seed") {
          const input = {
            sessionID: session,
            from: 1,
            through: 1,
            sourcePromptIndex: 0,
            source: `persisted source for ${session}`,
          }
          yield* memory.enqueue(input)
          yield* memory.enqueue(input)
        }
        if (["park", "claim", "finish", "journal-crash", "manifest-crash"].includes(step)) {
          const lease = yield* memory.claim({
            owner: extra.owner ?? String(process.pid),
            now,
            duration: 5000,
            sessionID: session,
          })
          result.lease = lease ?? null
          if (step === "park") {
            console.log(JSON.stringify(result))
            return yield* Effect.never
          }
          if (["finish", "journal-crash", "manifest-crash"].includes(step)) {
            assert.ok(lease)
            const outcome = MemoryCapture.parse(
              JSON.stringify({
                outcome: "observations",
                observations: [
                  {
                    type: "project",
                    statement: `DURABLE_${session.replaceAll("-", "_")} knowledge`,
                    keywords: [session],
                    aliases: [],
                  },
                ],
              }),
              "test-model",
              1788000000,
            )
            if (step !== "finish") {
              const obstructed = join(memory.root.path, step === "journal-crash" ? "observations/_inbox" : "MEMORY.md")
              yield* Effect.promise(async () => {
                await rename(obstructed, `${obstructed}.parked`)
                if (step === "journal-crash") await writeFile(obstructed, "simulated interruption")
                if (step === "manifest-crash") await mkdir(obstructed)
              })
              const exit = yield* memory.commit(lease, outcome, now + 100).pipe(Effect.result)
              assert.equal(exit._tag, "Failure")
              console.log(
                JSON.stringify({
                  obstructed,
                  status: (yield* memory.jobs(session))[0].status,
                  cursors: yield* memory.cursors(session),
                }),
              )
              return yield* Effect.never
            }
            Object.assign(result, yield* memory.commit(lease, outcome, now + 100))
          }
        }
        result.jobs = yield* memory.jobs(session)
        result.cursors = yield* memory.cursors(session)
        if (step === "inspect") result.matches = yield* memory.search(`DURABLE_${session.replaceAll("-", "_")}`)
        console.log(JSON.stringify(result))
      }),
    ),
  )
}
