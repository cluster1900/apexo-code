// Native CLI/Desktop host wait acceptance. Configuration is V1 and migrates into Core.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const evidence = []
for (const scenario of [
  { name: "default-and-ms-cap", config: { default_block_until_ms: 40, max_block_until_ms: 80 }, default: 40, max: 80 },
  { name: "seconds-cap", config: { default_block_until_ms: 500, max_timeout_secs: 0.03 }, default: 30, max: 30 },
  {
    name: "immediate",
    config: { default_block_until_ms: 0, max_block_until_ms: 0, max_timeout_secs: 0 },
    default: 0,
    max: 36_000_000,
  },
]) {
  const cases = []
  const sent = new Set()
  const runtime = await startShellFixture(process.argv[2] ?? "cli", {
    config: { toolset: { bash: scenario.config } },
    next({ input, ancillary }) {
      if (ancillary) return { content: "Shell config fixture" }
      const users = input
        .filter((item) => item.role === "user")
        .map((item) =>
          typeof item.content === "string"
            ? item.content
            : (item.content ?? []).map((part) => part.text ?? "").join("\n"),
        )
      const index = Number(users[0]?.match(/NATIVE_HOST_(\d+)/)?.[1])
      if (!Number.isInteger(index) || sent.has(index)) return { content: "NATIVE_HOST_ACK" }
      sent.add(index)
      return { tool: "bash", args: cases[index] }
    },
  })
  try {
    await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
    for (const input of [undefined, scenario.max === 36_000_000 ? 40 : 500]) {
      const index = cases.length
      cases.push({
        command: `echo $$ > host-${index}.pid; printf BEGIN; while [ ! -f host-${index}.release ]; do sleep 0.02; done; printf END`,
        description: "Configured native foreground wait",
        ...(input === undefined ? {} : { block_until_ms: input }),
      })
      const session = (
        await runtime.api("/api/session", {
          location: { directory: runtime.directory },
          model: { providerID: "xai", id: "grok-4.7" },
          agent: "build",
        })
      ).data
      const started = Date.now()
      await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text: `NATIVE_HOST_${index}` } })
      await poll(async () => {
        const list = await runtime.api(`/api/session/${session.id}/process`)
        return list.find((item) => item.background && item.status === "running")
      }, "configured native process promotion")
      await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
      const processInfo = (await runtime.api(`/api/session/${session.id}/process`))[0]
      const elapsed = Date.now() - started
      assert.ok(elapsed < 5000, `Host wait was not applied: ${elapsed}ms`)
      const pid = await poll(
        async () => Number(await readFile(join(runtime.directory, `host-${index}.pid`), "utf8").catch(() => "")),
        "owned PID",
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      process.kill(pid, 0)
      assert.equal(Number(await readFile(join(runtime.directory, `host-${index}.pid`), "utf8")), pid)
      await writeFile(join(runtime.directory, `host-${index}.release`), "finish")
      const result = await runtime.api(`/api/session/${session.id}/process/${processInfo.id}/wait`, { timeoutMs: 5000 })
      assert.equal(result.process.status, "completed")
      assert.equal(result.process.output, "BEGINEND")
      assert.throws(() => process.kill(pid, 0))
      evidence.push({
        scenario: scenario.name,
        input,
        expectedWait: Math.min(input ?? scenario.default, scenario.max),
        elapsed,
        processID: processInfo.id,
        samePID: true,
        completed: true,
      })
    }
    await writeFile(join(runtime.output, "native-shell-config.json"), JSON.stringify(evidence, null, 2))
  } finally {
    await Promise.all(cases.map((_, index) => writeFile(join(runtime.directory, `host-${index}.release`), "cleanup")))
    await runtime.close()
  }
}
console.log(JSON.stringify({ kind: process.argv[2] ?? "cli", checks: evidence.length, evidence }))
