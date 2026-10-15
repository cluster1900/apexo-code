// Native CLI/Desktop prefix and character-preview acceptance through the ordinary tool registry.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture } from "./grok-shell-fixture.mjs"

const evidence = []
for (const scenario of [
  { name: "unicode", limit: 5, command: "printf '甲😀乙🚀丙丁'", output: "甲😀乙🚀丙丁" },
  { name: "zero", limit: 0, command: "printf SECRET_ZERO", output: "SECRET_ZERO" },
]) {
  let sent = false
  const observed = []
  const runtime = await startShellFixture(process.argv[2] ?? "cli", {
    config: {
      toolset: {
        bash: {
          default_block_until_ms: 1000,
          cmd_prefix: "export PREFIX_OWNED=present; printf '%s' \"$PREFIX_OWNED\" > prefix-proof",
          output_byte_limit: scenario.limit,
        },
      },
    },
    next({ input, ancillary }) {
      if (ancillary) return { content: "Shell prefix fixture" }
      observed.push(
        ...input
          .filter((item) => item.role === "tool" || item.type === "function_call_output")
          .map((item) =>
            typeof (item.output ?? item.content) === "string"
              ? (item.output ?? item.content)
              : JSON.stringify(item.output ?? item.content),
          ),
      )
      if (sent) return { content: "NATIVE_PREFIX_ACK" }
      sent = true
      return { tool: "bash", args: { command: scenario.command, description: "Native prefix output probe" } }
    },
  })
  try {
    await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    await runtime.api(`/api/session/${session.id}/prompt`, { prompt: { text: "Execute native prefix output probe" } })
    await runtime.api(`/api/session/${session.id}/wait`, undefined, "POST")
    const receipt = (await runtime.api(`/api/session/${session.id}/process`))[0]
    assert.equal(receipt.status, "completed")
    assert.equal(await readFile(join(runtime.directory, "prefix-proof"), "utf8"), "present")
    const result = observed.join("")
    assert.ok(result.includes(receipt.id), "Receipt identity survives zero command-output limit")
    assert.ok(!result.includes(scenario.output))
    const retained = result.match(/full captured content saved to ([^ ]+) \.\.\./)?.[1]
    assert.ok(retained, "Full captured output has a managed path")
    assert.equal(await readFile(retained, "utf8"), scenario.output)
    if (scenario.limit) {
      assert.ok(result.includes("甲😀"))
      assert.ok(result.includes("丙丁"))
    }
    evidence.push({
      scenario: scenario.name,
      processID: receipt.id,
      complete: true,
      prefix: true,
      fullOutput: true,
      metadata: true,
    })
    await writeFile(join(runtime.output, "native-shell-prefix-output.json"), JSON.stringify(evidence, null, 2))
  } finally {
    await runtime.close()
  }
}
console.log(JSON.stringify({ kind: process.argv[2] ?? "cli", checks: evidence.length, evidence }))
