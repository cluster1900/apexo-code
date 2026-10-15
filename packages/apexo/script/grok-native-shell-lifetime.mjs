// Native CLI/Desktop owned lifetime acceptance. No reference runtime is used by product execution.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const evidence = []
const commands = []
const sent = new Set()
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  config: { toolset: { bash: { default_block_until_ms: 0, max_timeout_secs: 0.001 } } },
  next({ input, ancillary }) {
    if (ancillary) return { content: "Lifetime fixture" }
    const text = input
      .filter((item) => item.role === "user")
      .map((item) =>
        typeof item.content === "string"
          ? item.content
          : (item.content ?? []).map((part) => part.text ?? "").join("\n"),
      )
      .join("\n")
    const index = Number(text.match(/LIFETIME_(\d+)/)?.[1])
    if (!Number.isInteger(index) || sent.has(index)) return { content: "LIFETIME_ACK" }
    sent.add(index)
    return { tool: "bash", args: commands[index] }
  },
})
try {
  await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
  for (const timeout of [undefined, 0, 700000, 40]) {
    const index = commands.length
    commands.push({
      command: `echo $$ > lifetime-${index}.pid; printf BEGIN; while :; do sleep 0.02; done`,
      description: "Owned native lifetime",
      ...(timeout === undefined ? {} : { timeout }),
    })
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text: `LIFETIME_${index}` } })
    await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
    const receipt = (await runtime.api(`/api/session/${session.id}/process`))[0]
    assert.ok(receipt, "Eligible owned execution produced a receipt")
    const published = () =>
      readFile(join(runtime.directory, `lifetime-${index}.pid`), "utf8")
        .then(Number)
        .catch(() => undefined)
    const pid = timeout === 40 ? await published() : await poll(published, "owned command PID")
    if (timeout === 40) {
      const result = await runtime.api(`/api/session/${session.id}/process/${receipt.id}/wait`, { timeoutMs: 5000 })
      assert.equal(result.process.status, "failed")
    } else {
      await new Promise((done) => setTimeout(done, 150))
      process.kill(pid, 0)
      await runtime.api(`/api/session/${session.id}/process/${receipt.id}/cancel`, undefined, "POST")
      assert.equal((await runtime.api(`/api/session/${session.id}/process`))[0].status, "cancelled")
    }
    if (pid !== undefined) assert.throws(() => process.kill(pid, 0))
    evidence.push({
      timeout: timeout ?? "omitted",
      processID: receipt.id,
      joined: true,
      pidObserved: pid !== undefined,
      deadline: timeout === 40,
      waitCapDidNotKill: timeout !== 40,
    })
  }
  await writeFile(join(runtime.output, "native-shell-lifetime.json"), JSON.stringify(evidence, null, 2))
} finally {
  await runtime.close()
}
console.log(JSON.stringify({ kind: process.argv[2] ?? "cli", checks: evidence.length, evidence }))
