// Actual CLI/Electron backends and SQLite opens. The forced journal policy is
// Grok's supported operational override, not a fake mounted filesystem.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { lstat, readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Effect } from "effect"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { MemoryFilesystem } from "@apexo/core/memory-filesystem"
import { MemoryTopicReads } from "@apexo/core/memory-topic-reads"
import { MemoryV2 } from "@apexo/core/memory-v2"
import { startShellFixture } from "./grok-shell-fixture.mjs"

await (process.argv[2] === "worker" ? worker() : run())

async function run() {
  const kind = process.argv[2] ?? "cli"
  const runtime = await startShellFixture(kind, {
    env: { GROK_SQLITE_JOURNAL_MODE: "TrUnCaTe" },
    config: { memory_v2: { enabled: true, capture_enabled: false, automatic_dream_enabled: false } },
  })
  const checks = []
  const evidence = []
  try {
    const input = {
      home: runtime.env.APEXO_TEST_HOME,
      directory: runtime.directory,
      projectID: (await runtime.api("/project/current")).id,
    }
    const root = MemoryV2.directory(input)
    const session = await runtime.api("/session", { title: "Filesystem policy" })
    const endpoint = `/experimental/session/${session.id}/memory`
    await assert.rejects(
      runtime.api(`${endpoint}/remember`, { content: "MUST_NOT_SAVE", scope: "workspace" }),
      /local filesystem/,
    )
    await assert.rejects(lstat(root), { code: "ENOENT" })
    checks.push("fresh-scope-rejected-before-creation")

    const built = await Bun.build({
      entrypoints: [fileURLToPath(import.meta.url)],
      target: kind === "desktop" ? "node" : "bun",
      format: "esm",
      outdir: join(runtime.output, "build"),
    })
    assert.equal(built.success, true, built.logs.map(String).join("\n"))
    const engine =
      kind === "cli"
        ? process.execPath
        : resolve(
            "../desktop/node_modules/electron/dist",
            (await readFile("../desktop/node_modules/electron/path.txt", "utf8")).trim(),
          )
    const call = async (action, mode) => {
      const result = await promisify(execFile)(
        engine,
        [built.outputs[0].path, "worker", action, JSON.stringify(input)],
        {
          env: {
            ...runtime.env,
            GROK_SQLITE_JOURNAL_MODE: mode,
            ...(kind === "desktop" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          timeout: 30000,
        },
      )
      const value = JSON.parse(result.stdout)
      evidence.push({ action, mode, ...value })
      return value
    }
    const seeded = await call("seed", "wal")
    assert.equal(seeded.network, false)
    assert.equal(seeded.root, root)
    checks.push("native-local-filesystem-probe", "local-wal-can-save")
    const before = await snapshot(root)
    for (const mode of ["truncate", "TRUNCATE"]) {
      const denied = await call("open", mode)
      assert.equal(denied.ok, false)
      assert.match(denied.error, /local filesystem/)
    }
    checks.push("case-insensitive-truncate-rejected")
    await assert.rejects(runtime.api(endpoint), /local filesystem/)
    await assert.rejects(
      runtime.api(`${endpoint}/remember`, { content: "MUST_NOT_SAVE", scope: "workspace" }),
      /local filesystem/,
    )
    const health = await runtime.api(`${endpoint}/health`)
    assert.deepEqual(health.scopes[0], { scope: "workspace", state: "unavailable", reason: "storage" })
    checks.push("existing-store-list-and-save-rejected", "diagnostic-does-not-open-remote-store")
    await call("record", "truncate")
    assert.deepEqual(await snapshot(root), before)
    checks.push("advisory-read-does-not-open-remote-store", "rejection-preserves-database-and-notes")
    await assert.rejects(
      promisify(execFile)("bun", [resolve("src/index.ts"), "memory", "clear", "--backend", "v2", "--yes"], {
        env: runtime.env,
        cwd: runtime.directory,
        timeout: 30000,
      }),
      /local filesystem/,
    )
    assert.deepEqual(await snapshot(root), before)
    checks.push("cli-clear-refuses-without-deleting")
    for (const mode of ["", "WAL", "unknown", " truncate "]) assert.equal((await call("open", mode)).ok, true)
    checks.push("unset-wal-and-invalid-override-use-local-detection")
    assert.equal(await readFile(seeded.note, "utf8"), "FILESYSTEM_SENTINEL")
    assert.equal(runtime.calls.length, 0)
    checks.push("no-model-call-and-saved-content-preserved")
    console.log(JSON.stringify({ kind, passed: checks.length, checks, output: runtime.output }, null, 2))
  } finally {
    await writeFile(join(runtime.output, "memory-filesystem.json"), JSON.stringify({ checks, evidence }, null, 2))
    await runtime.close()
  }
}

async function snapshot(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const file = join(entry.parentPath, entry.name)
          return [file, MemoryV2.hash(await readFile(file))]
        }),
    ),
  )
}

async function worker() {
  const action = process.argv[3]
  const input = JSON.parse(process.argv[4])
  const root = MemoryV2.directory(input)
  if (action === "record") {
    await Effect.runPromise(MemoryTopicReads.record({ ...input, permitted: () => true }, join(root, "topics/probe.md")))
    console.log(JSON.stringify({ ok: true }))
    return
  }
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* MemoryCapture.make(input)
        if (action === "seed") {
          const note = yield* store.remember("FILESYSTEM_SENTINEL", () => true)
          yield* Effect.promise(() => writeFile(join(root, "topics/probe.md"), "# Probe\nLOCAL_TOPIC"))
          yield* store.reconcile
          return {
            ok: true,
            root,
            note: note.path,
            network: yield* Effect.promise(() => MemoryFilesystem.network(root)),
          }
        }
        return { ok: true, root }
      }),
    ).pipe(Effect.catchCause((cause) => Effect.succeed({ ok: false, error: String(cause) }))),
  )
  console.log(JSON.stringify(result))
}
