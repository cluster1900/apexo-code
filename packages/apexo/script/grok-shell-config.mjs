// bun script/grok-shell-config.mjs cli|desktop
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const evidence = []
for (const scenario of [
  {
    name: "block-cap",
    config: { default_block_until_ms: 40, max_block_until_ms: 80, max_timeout_secs: 0.2 },
    default: 40,
    max: 80,
  },
  {
    name: "seconds-cap",
    config: { default_block_until_ms: 1000, max_block_until_ms: 300, max_timeout_secs: 0.08 },
    default: 80,
    max: 80,
  },
  {
    name: "immediate-default",
    config: { default_block_until_ms: 0, max_block_until_ms: 0, max_timeout_secs: 0 },
    default: 0,
    max: 36_000_000,
  },
]) {
  const cases = []
  const sent = new Set()
  const schemas = []
  const sessions = []
  const runtime = await startShellFixture(process.argv[2] ?? "cli", {
    config: { toolset: { bash: scenario.config } },
    next({ body, text, finished, ancillary }) {
      if (ancillary) return
      const schema = body.tools
        .map((item) => item.function ?? item)
        .find((item) => item.name === "run_terminal_cmd")?.parameters
      if (schema) schemas.push(schema)
      const index = Number(text.match(/HOST_SHELL_(\d+)/)?.[1])
      if (!Number.isInteger(index) || sent.has(index) || finished) return
      sent.add(index)
      return cases[index]
    },
  })
  try {
    for (const input of [undefined, ...(scenario.max < 36_000_000 ? [10_000] : [40]), 0]) {
      const index = cases.length
      const session = await runtime.api("/session", { title: `Shell host ${scenario.name} ${index}` })
      sessions.push(session.id)
      cases.push({
        tool: "run_terminal_cmd",
        args: {
          command: `echo $$ > host-${index}.pid; printf HOST_STARTED; while [ ! -f host-${index}.release ]; do sleep 0.05; done; printf HOST_FINISHED`,
          description: "Verify host-configured Shell wait and process lifetime",
          ...(input === undefined ? {} : { block_until_ms: input }),
        },
      })
      await runtime.api(`/session/${session.id}/prompt_async`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text: `HOST_SHELL_${index}` }],
      })
      const part = await poll(
        async () =>
          (await runtime.api(`/session/${session.id}/message`))
            .flatMap((message) => message.parts)
            .find((part) => part.type === "tool" && ["completed", "error"].includes(part.state.status)),
        "configured Shell result",
      )
      assert.equal(part.state.status, "completed", JSON.stringify(part.state))
      assert.equal(part.state.metadata.background, true)
      const expected = Math.min(input ?? scenario.default, scenario.max)
      const elapsed = part.state.time.end - part.state.time.start
      assert.ok(
        elapsed >= expected - 5 && elapsed < 3000,
        `${scenario.name}: waited ${elapsed}ms, expected ${expected}ms`,
      )
      assert.equal(part.state.metadata.timed_out, expected === 0 ? undefined : true)
      const pid = await poll(
        async () => Number(await readFile(join(runtime.directory, `host-${index}.pid`), "utf8").catch(() => "")),
        "process PID",
      )
      // A real elapsed deadline verifies host max_timeout_secs never becomes a kill timer.
      await new Promise((resolve) => setTimeout(resolve, 400))
      process.kill(pid, 0)
      assert.equal(schemas.at(-1).properties.block_until_ms.maximum, scenario.max)
      assert.ok(schemas.at(-1).properties.block_until_ms.description.includes(`defaults to ${scenario.default}ms`))
      await writeFile(join(runtime.directory, `host-${index}.release`), "release")
      await poll(
        async () =>
          (await runtime.api(`/session/${session.id}/message`))
            .flatMap((message) => message.parts)
            .some(
              (part) =>
                part.type === "text" &&
                part.text.includes("Background command completed:") &&
                part.text.includes("HOST_FINISHED"),
            ),
        "background completion with full output",
      )
      evidence.push({ scenario: scenario.name, input, expected, elapsed, survived: true })
    }
    await writeFile(join(runtime.output, "host-config.json"), JSON.stringify({ scenario, schemas, evidence }, null, 2))
  } finally {
    await Promise.all(cases.map((_, index) => writeFile(join(runtime.directory, `host-${index}.release`), "cleanup")))
    await Promise.all(sessions.map((id) => runtime.api(`/session/${id}`, undefined, "DELETE").catch(() => {})))
    await runtime.close()
    console.error(`Shell host evidence: ${runtime.output}`)
  }
}
console.log(JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", cases: evidence.length, evidence }))
