// Official installed agent, real ACP requests, isolated state. A forced
// TRUNCATE policy exercises refusal; it does not simulate an actual NFS mount.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { deadline } from "./grok-shell-fixture.mjs"
import { mountWebDAV } from "./grok-memory-webdav.mjs"

const output = await mkdtemp(join(tmpdir(), "apexo-memory-filesystem-official-"))
const workspace = await mkdtemp(join(resolve("../.."), ".memory-filesystem-test-"))
execFileSync("git", ["init"], { cwd: workspace, stdio: "pipe" })
execFileSync("git", ["remote", "add", "origin", "https://example.invalid/memory/filesystem.git"], {
  cwd: workspace,
  stdio: "pipe",
})
const checks = []
const evidence = []
try {
  for (const mode of ["wal", "truncate", ...(process.argv.includes("--mounted") ? ["webdav"] : [])]) {
    const home = join(output, mode)
    await mkdir(home)
    await writeFile(join(home, "config.toml"), "[memory]\nenabled = true\n[memory_v2]\nenabled = true\n")
    const mounted = mode === "webdav" ? await mountWebDAV(join(home, "memory-v2/global")) : undefined
    const child = spawn("bun", ["run", "src/index.ts", "acp", "--backend", "grok-build", "--cwd", workspace], {
      cwd: resolve("."),
      env: {
        ...process.env,
        GROK_HOME: home,
        GROK_CONFIG: "",
        GROK_CONFIG_PATH: "",
        GROK_MEMORY: "1",
        GROK_SQLITE_JOURNAL_MODE: mode === "webdav" ? "wal" : mode,
        XAI_API_KEY: "local-fixture-key",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const exited = new Promise((resolve) => child.once("exit", resolve))
    const errors = []
    child.stderr.on("data", (chunk) => errors.push(chunk))
    const connection = new ClientSideConnection(
      () => ({
        async requestPermission() {
          throw new Error("No tools are expected")
        },
        async sessionUpdate() {},
        async extNotification() {},
      }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
    )
    try {
      await deadline(
        connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
        30000,
        "official initialize",
      )
      const result = await deadline(
        (async () => {
          const session = await connection.newSession({ cwd: workspace, mcpServers: [] })
          const response = await connection.extMethod("_x.ai/memory/list", { sessionId: session.sessionId })
          return { ok: true, value: response.result ?? response }
        })().catch((error) => ({ ok: false, error: String(error) })),
        30000,
        "official filesystem policy",
      )
      const files = await readdir(home, { recursive: true })
      const state = files.filter(
        (file) => file.includes("memory-v2/") && /(?:memory_state(?:\.|-)|index\.sqlite|MEMORY\.md$)/.test(file),
      )
      evidence.push({ mode, result, state })
      if (mode === "wal") {
        assert.equal(result.ok, true, result.error)
        assert.equal(result.value.enabled, true)
        assert.ok(state.some((file) => file.endsWith("memory_state.sqlite")))
        checks.push("official-local-wal-opens-v2")
        continue
      }
      // 1.0.52 converts the storage error into a disabled session. Verify both
      // the public state and its cause instead of treating any empty list as refusal.
      assert.equal(result.ok, true, result.error)
      assert.equal(result.value.enabled, false)
      assert.equal(result.value.disabled_reason, "not_configured")
      assert.deepEqual(result.value.files, [])
      assert.match(
        Buffer.concat(errors).toString(),
        /network filesystem; memory-v2 requires local shared-memory coordination/,
      )
      assert.deepEqual(state, [])
      checks.push(`official-${mode}-refuses-v2`, `official-${mode}-creates-no-shared-state`)
      if (mounted) {
        assert.ok(mounted.requests.every((request) => ["OPTIONS", "PROPFIND", "HEAD", "GET"].includes(request.method)))
        checks.push("official-no-webdav-writes")
        evidence.push({ mode, requests: mounted.requests })
      }
    } finally {
      child.kill("SIGTERM")
      await deadline(exited, 10000, "official cleanup").catch(() => child.kill("SIGKILL"))
      await writeFile(join(home, "stderr.log"), Buffer.concat(errors))
      await mounted?.close()
    }
  }
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2))
} finally {
  await writeFile(join(output, "evidence.json"), JSON.stringify({ checks, evidence }, null, 2))
  await rm(workspace, { recursive: true, force: true })
  console.error(`Official filesystem evidence: ${output}`)
}
