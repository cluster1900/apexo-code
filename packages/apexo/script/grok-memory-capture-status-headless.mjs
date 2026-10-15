import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import { writeFile } from "node:fs/promises"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

const plan = { capture: undefined, foreground: undefined, extracting: false, waiting: false }
const runtime = await startShellFixture("cli", {
  config: {
    memory_v2: { enabled: true, capture_status_enabled: true, automatic_dream_enabled: false },
    memory: { dream: { enabled: false }, session: { save_on_end: false } },
    compaction: { memory_flush: { enabled: false } },
  },
  async next({ input, text }) {
    if (JSON.stringify(input).includes("You extract durable memory observations")) {
      plan.extracting = true
      if (plan.capture) await plan.capture.promise
      return {
        content: JSON.stringify({
          outcome: "observations",
          observations: [
            {
              type: "project",
              statement: "HEADLESS_CAPTURE_FACT",
              body: "HEADLESS_CAPTURE_DETAIL",
              topic_hint: "headless",
              keywords: [],
              aliases: [],
            },
          ],
        }),
      }
    }
    if (text.includes("HEADLESS_HOLD")) {
      plan.waiting = true
      if (plan.foreground) await plan.foreground.promise
    }
    return { content: "HEADLESS_FOREGROUND_ACK" }
  },
})
let child
const results = []
try {
  for (const format of ["default", "json", "streaming-json"]) {
    const id = (await runtime.api("/session", { title: `Headless ${format}` })).id
    Object.assign(plan, {
      capture: Promise.withResolvers(),
      foreground: Promise.withResolvers(),
      extracting: false,
      waiting: false,
    })
    await runtime.api(`/session/${id}/message`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: "Save headless capture conventions." }],
    })
    await poll(() => plan.extracting, "initial capture starts")
    child = Bun.spawn(
      [
        process.execPath,
        resolve("src/index.ts"),
        "run",
        "--attach",
        runtime.url,
        "--session",
        id,
        "--dir",
        runtime.directory,
        "--format",
        format,
        "HEADLESS_HOLD",
      ],
      { env: runtime.env, stdout: "pipe", stderr: "pipe" },
    )
    const out = { text: "", error: "" }
    const read = (async () => {
      for await (const bytes of child.stdout) out.text += new TextDecoder().decode(bytes)
    })()
    const errors = (async () => {
      for await (const bytes of child.stderr) out.error += new TextDecoder().decode(bytes)
    })()
    await poll(() => plan.waiting, "headless subscription and foreground model ready", 30_000)
    plan.capture.resolve()
    plan.capture = undefined
    await poll(
      () => (format === "default" ? out.error : out.text).includes("HEADLESS_CAPTURE_DETAIL"),
      "headless capture event reaches output",
    )
    if (format === "default") assert.match(out.error, /Memory capture: completed/)
    if (format !== "default") {
      const event = out.text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .find((event) => event.type === "memory_capture_activity" && event.activity === "completed")
      assert.equal(event.sessionID, id)
      assert.equal(event.memories[0].statement, "HEADLESS_CAPTURE_FACT")
      assert.ok(event.memories[0].path.startsWith("/"))
    }
    assert.equal((await runtime.api("/session/status"))[id].type, "busy")
    plan.foreground.resolve()
    plan.foreground = undefined
    assert.equal(await deadline(child.exited, 30_000, "headless exits on foreground completion"), 0, out.error)
    await read
    await errors
    assert.doesNotMatch(JSON.stringify(await runtime.api(`/session/${id}/message`)), /HEADLESS_CAPTURE_DETAIL/)
    results.push({
      format,
      checks: ["capture-output", "foreground-remains-busy-until-model-completes", "details-not-in-transcript"],
      output: out,
    })
    child = undefined
  }
  console.log(
    JSON.stringify({ passed: results.length * 3, formats: results.map((row) => row.format), output: runtime.output }),
  )
} finally {
  plan.capture?.resolve()
  plan.foreground?.resolve()
  child?.kill("SIGTERM")
  if (child) await deadline(child.exited, 10_000, "headless cleanup").catch(() => child.kill("SIGKILL"))
  await runtime.close()
  await writeFile(join(runtime.output, "capture-headless.json"), JSON.stringify(results, null, 2))
  console.error(`Capture headless evidence: ${runtime.output}`)
}
