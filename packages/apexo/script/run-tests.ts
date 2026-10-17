import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)

if (args.length > 0) {
  const proc = Bun.spawn([process.execPath, "test", "--timeout", "30000", "--only-failures", ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  })
  process.exit(await proc.exited)
}

const files = (
  await Array.fromAsync(new Bun.Glob("test/**/*.test.{ts,tsx}").scan({ cwd: root, onlyFiles: true }))
).toSorted()

const batchSize = Math.max(1, Number(Bun.env.APEXO_TEST_BATCH_SIZE ?? 30))
const batchCount = Math.ceil(files.length / batchSize)
// Round-robin across batches so heavy directories (e2e, v2, session, server, tool) are evenly spread.
const batches = Array.from({ length: batchCount }, (_, batch) =>
  files.filter((_, index) => index % batchCount === batch),
)

const workerCount = Math.max(
  1,
  Math.min(batches.length, Number(Bun.env.APEXO_TEST_SHARDS ?? Math.min(2, Math.max(1, os.availableParallelism())))),
)

const queue = batches.map((batchFiles, index) => ({ index, batchFiles }))
const failures: Array<{ index: number; exitCode: number; output: string }> = []

async function runBatch(item: { index: number; batchFiles: string[] }) {
  const start = performance.now()
  const proc = Bun.spawn([process.execPath, "test", "--timeout", "30000", "--only-failures", ...item.batchFiles], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  })
  const timer = setTimeout(() => {
    proc.kill("SIGKILL")
  }, 600_000)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const seconds = ((performance.now() - start) / 1000).toFixed(2)
  console.log(
    `[apexo:test batch ${item.index + 1}/${batches.length}] exit=${exitCode} (${item.batchFiles.length} files, ${seconds}s)`,
  )
  if (exitCode !== 0) {
    const combined = `${stdout}\n${stderr}`.trim()
    console.error(combined)
    const lines = combined.split(/\r?\n/).filter((line) => line.trim().length > 0)
    lines
      .map((line, idx) => ({ line, idx }))
      .filter((entry) => entry.line.startsWith("(fail)"))
      .forEach((entry) => {
        const detail = lines
          .slice(entry.idx, entry.idx + 8)
          .join(" | ")
          .slice(0, 1200)
        console.log(`::error title=apexo batch ${item.index + 1}/${batches.length} test failure::${detail}`)
      })
    const tail = lines.slice(-25).join(" | ").slice(0, 1500)
    console.log(
      `::error title=apexo batch ${item.index + 1}/${batches.length} failed (exit ${exitCode})::${tail || item.batchFiles.join(", ")}`,
    )
    failures.push({ index: item.index, exitCode, output: combined })
  }
}

await Promise.all(
  Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      await runBatch(next)
    }
  }),
)

if (failures.length > 0) {
  process.exit(failures[0]!.exitCode || 1)
}
