// bun script/grok-shell-parity.mjs cli|desktop
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const runtime = await startShellFixture(process.argv[2] ?? "cli")
const modes = ["explicit", "steer", "default", "immediate", "bounded", "stop"]
const evidence = []
const sessions = []
try {
  for (const mode of modes) {
    const session = await runtime.api("/session", { title: `Shell ${mode}` })
    sessions.push(session.id)
    const prompt = (text) =>
      runtime.api(`/session/${session.id}/prompt_async`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text }],
      })
    const messages = () => runtime.api(`/session/${session.id}/message`)
    const before = runtime.calls.filter((call) => call.wake).length
    await prompt(`SHELL_START_${mode}`)
    const pid = await poll(
      async () => Number(await readFile(join(runtime.directory, `${mode}.pid`), "utf8").catch(() => "")),
      "shell started",
    )
    const started = Date.now()
    const tool = await poll(
      async () =>
        (await messages())
          .flatMap((item) => item.parts)
          .find((part) => part.type === "tool" && part.tool === "run_terminal_cmd" && part.state.metadata?.task_id),
      "tool metadata",
    )
    if (mode === "explicit")
      assert.equal(await runtime.api(`/experimental/session/${session.id}/background`, undefined, "POST"), true)
    if (mode === "steer") await prompt("SHELL_STEER continue the conversation")
    if (mode === "stop") {
      await runtime.api(`/session/${session.id}/abort`, undefined, "POST")
      await poll(() => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      }, "foreground process stopped")
      assert.equal(runtime.calls.filter((call) => call.wake).length, before)
      evidence.push({ mode, pid, stopped: true })
      continue
    }
    await poll(
      async () =>
        (await messages())
          .flatMap((item) => item.parts)
          .some(
            (part) =>
              part.type === "tool" &&
              part.id === tool.id &&
              part.state.status === "completed" &&
              part.state.metadata?.background === true,
          ),
      "same tool backgrounded",
      40_000,
    )
    const elapsed = Date.now() - started
    if (mode === "default") assert.ok(elapsed >= 28_000 && elapsed < 36_000, `Default wait was ${elapsed}ms`)
    await poll(async () => {
      const status = (await runtime.api("/session/status"))[session.id]
      return !status || status.type === "idle"
    }, "parent idle")
    // Advance beyond the deliberately short normal-shell deadline; the background process must survive it.
    await new Promise((resolve) => setTimeout(resolve, 400))
    process.kill(pid, 0)
    assert.equal(Number(await readFile(join(runtime.directory, `${mode}.pid`), "utf8")), pid)
    await writeFile(join(runtime.directory, `${mode}.release`), "release")
    await poll(
      async () =>
        (await messages())
          .flatMap((item) => item.parts)
          .some((part) => part.type === "text" && part.text.includes("SHELL_WAKE_OK")),
      "automatic completion reply",
    )
    assert.equal(runtime.calls.filter((call) => call.wake).length - before, 1, "Completion must wake exactly once")
    assert.equal(runtime.calls.filter((call) => call.action && call.mode === mode).length, 1, "Command must start once")
    const history = await messages()
    const notification = history
      .flatMap((item) => item.parts)
      .find((part) => part.type === "text" && part.text.startsWith("Background command completed:"))
    assert.ok(notification?.text.includes("😀") && notification.text.includes("SHELL_STDERR_中文"))
    assert.ok(!notification.text.includes("�"), "Shell output must preserve UTF-8")
    evidence.push({ mode, pid, toolID: tool.id, jobID: tool.state.metadata.task_id, elapsed, wakes: 1 })
    await writeFile(join(runtime.output, `${mode}-history.json`), JSON.stringify(history, null, 2))
  }
  console.log(
    JSON.stringify({ result: "pass", kind: process.argv[2] ?? "cli", output: runtime.output, scenarios: evidence }),
  )
} finally {
  await Promise.all(modes.map((mode) => writeFile(join(runtime.directory, `${mode}.release`), "cleanup")))
  await Promise.all(sessions.map((id) => runtime.api(`/session/${id}/abort`, undefined, "POST").catch(() => {})))
  await runtime.close()
  console.error(`Shell parity evidence: ${runtime.output}`)
}
