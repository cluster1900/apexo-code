// Explicit synthetic pre-event receipt-only state, created through real capture/GC writers.
// This is an Apexo migration fixture, not captured historical user data.
import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function createHistoricalMemoryFixture(kind = "cli") {
  const calls = { extraction: 0 }
  const runtime = await startShellFixture(kind, {
    config: {
      memory_v2: {
        enabled: true,
        rollout: "active",
        capture_enabled: true,
        automatic_dream_enabled: false,
        maintenance_interval_secs: 0,
      },
      memory: { enabled: true, dream: { enabled: false, check_interval_secs: 0 }, session: { save_on_end: false } },
      compaction: { auto: false, memory_flush: { enabled: false } },
    },
    next: async ({ input }) => {
      if (!JSON.stringify(input).includes("You extract durable memory observations"))
        return { content: "MEMORY_OWNERSHIP_ACK" }
      calls.extraction++
      return {
        content: JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "FRESH_SESSION_MEMORY: new Sessions still capture normally",
              topic_hint: "ownership",
              keywords: ["fresh"],
              aliases: [],
              body: null,
            },
          ],
        }),
      }
    },
  })
  try {
    const session = await runtime.api("/session", { title: "Synthetic historical Memory ownership" })
    await runtime.crash()
    const seedPath = join(runtime.output, "memory-owner-seed.json")
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `const seed = await (${seedHistorical.toString()})(await Bun.stdin.json()); await Bun.write(process.env.APEXO_MEMORY_SEED_OUTPUT, JSON.stringify(seed))`,
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...runtime.env, APEXO_MEMORY_SEED_OUTPUT: seedPath },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    child.stdin.write(JSON.stringify({ home: runtime.env.APEXO_TEST_HOME, session }))
    child.stdin.end()
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    try {
      const code = await deadline(child.exited, 30_000, "historical Memory seed subprocess")
      const logs = await output
      assert.equal(code, 0, `Historical Memory seed failed: ${logs.join("\n")}`)
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
      await output
    }
    const seed = JSON.parse(await readFile(seedPath, "utf8"))
    const rows = (sql, ...parameters) => {
      const db = new Database(join(seed.root, "memory_state.sqlite"), { readonly: true })
      try {
        return db.query(sql).all(...parameters)
      } finally {
        db.close()
      }
    }
    const ledger = () => ({
      sessions: rows("SELECT * FROM capture_sessions WHERE session_id = ?", session.id),
      admissions: rows("SELECT * FROM capture_admissions WHERE session_id = ? ORDER BY prompt_id", session.id),
      jobs: rows("SELECT * FROM capture_jobs WHERE session_id = ? ORDER BY job_id", session.id),
      incarnation: rows("SELECT * FROM capture_meta WHERE key = ?", `incarnation:${session.id}`),
      notes: rows("SELECT * FROM memory_notes WHERE path = ?", seed.note.slice(seed.root.length + 1)),
    })
    const before = ledger()
    assert.equal(before.admissions.length, 1)
    assert.deepEqual(
      before.sessions.map(({ requested, captured, indexed }) => ({ requested, captured, indexed })),
      [{ requested: 1, captured: 1, indexed: 1 }],
    )
    assert.deepEqual(before.jobs, [])
    assert.deepEqual(before.incarnation, [])
    assert.equal(before.notes.length, 1)
    const content = await readFile(seed.note, "utf8")
    await runtime.reopen()
    const flush = async (id = session.id) => {
      const endpoint = `/experimental/session/${id}/memory/operation`
      await runtime.api(endpoint, { kind: "flush" })
      return poll(
        async () => {
          const value = await runtime.api(endpoint)
          return value?.state === "finished" && value.result
        },
        "Memory ownership flush settled",
        30_000,
      )
    }
    const preserved = async () => {
      assert.deepEqual(ledger(), before)
      assert.equal(await readFile(seed.note, "utf8"), content)
    }
    return { runtime, session, seed, calls, before, ledger, preserved, flush, rows }
  } catch (error) {
    await runtime.close()
    throw error
  }
}

// Run Core imports only after the child receives the fixture's private environment.
async function seedHistorical(input) {
  const { Effect } = await import("effect")
  const { MemoryCapture } = await import("@apexo/core/memory-capture")
  const { default: assert } = await import("node:assert/strict")
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* MemoryCapture.make({
          home: input.home,
          directory: input.session.directory,
          projectID: input.session.projectID,
        })
        const now = Date.now()
        const promptID = "msg_synthetic_historical_capture"
        // No adopt call: older writers had no persisted Session incarnation field.
        const admitted = yield* store.admit({
          sessionID: input.session.id,
          promptID,
          sourcePromptIndex: 0,
          exposed: true,
          createdAt: now - 2000,
          source: JSON.stringify({
            version: 1,
            user: {
              id: promptID,
              sessionID: input.session.id,
              role: "user",
              time: { created: now - 2000 },
              agent: "build",
              model: { providerID: "xai", modelID: "grok-4.7" },
            },
            transcript: "Synthetic legacy completed turn for receipt-only migration acceptance.",
          }),
        })
        assert.equal(admitted.admitted, true)
        const lease = yield* store.claim({
          owner: "synthetic-legacy-seeder",
          sessionID: input.session.id,
          now: now - 1000,
          duration: 5000,
        })
        assert.ok(lease)
        yield* store.commit(lease, { outcome: "noop", observations: [] }, now - 500)
        const collected = yield* store.gc(now, { archivedDays: 0, jobDays: 0 }, () => true)
        assert.equal(collected.jobs, 1)
        const note = yield* store.remember(
          "PRESERVED_HISTORICAL_NOTE: ownership ambiguity must not erase durable knowledge.",
          () => true,
        )
        return { root: store.root.path, note: note.path, promptID }
      }),
    ),
  )
}
