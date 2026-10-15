// Actual native Session/provider Monitor lifecycle on private CLI or packaged Desktop backends.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const states = new Map(),
  checks = [],
  calls = []
const state = (mode) => {
  if (!states.has(mode))
    states.set(mode, { calls: 0, events: 0, eventText: "", completions: 0, active: Promise.withResolvers() })
  return states.get(mode)
}
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ input, ancillary }) => {
    if (ancillary) return { content: "Monitor acceptance" }
    const original = input.find(
      (item) => item.role === "user" && JSON.stringify(item.content).includes("MONITOR_NATIVE_"),
    )
    const mode = JSON.stringify(original).match(
      /MONITOR_NATIVE_(idle|active|wait|cancel|stop|rearm|delete|timeout|overload|restart)/,
    )?.[1]
    assert.ok(mode, "Expected the original user scenario marker")
    const current = state(mode)
    current.calls++
    calls.push({ mode, turn: current.calls })
    const latest = input.findLast((item) => item.role === "user")
    const text =
      typeof latest?.content === "string"
        ? latest.content
        : Array.isArray(latest?.content)
          ? latest.content.flatMap((part) => (typeof part.text === "string" ? [part.text] : [])).join("\n")
          : ""
    const update = text.startsWith("<system-update>") ? text : ""
    if (update.includes("Background shell completion data follows")) {
      current.completions++
      assert.match(update, mode === "overload" ? /overload/ : mode === "timeout" ? /failed/ : /TAIL/)
      return { content: `TERMINAL_${mode}` }
    }
    if (update.includes("Live Monitor data follows")) {
      current.events++
      current.eventText += update
      if (mode === "idle") assert.doesNotMatch(update, /�/)
      if (!["idle", "overload", "rearm"].includes(mode)) {
        assert.match(update, /EVENT😀/)
        assert.match(update, /ERROR中文/)
        assert.doesNotMatch(update, /�/)
      }
      if (mode === "rearm") {
        assert.match(update, /FUTURE/)
        assert.doesNotMatch(update, /EVENT😀|RESUME_ONLY/)
      }
      return { content: `EVENT_${mode}_${current.events}` }
    }
    if (current.calls === 1)
      return {
        tool: "monitor",
        args: {
          command:
            mode === "overload"
              ? `echo $$ > ${mode}.pid; while true; do printf 'NOISY\n'; sleep 0.02; done`
              : `echo $$ > ${mode}.pid; while [ ! -f ${mode}.event ]; do sleep 0.02; done; ${mode === "idle" ? "printf 'EVENT\\360\\237'; sleep 0.03; printf 'ERROR中文\\n' >&2; sleep 0.03; printf '\\230\\200\\n';" : "printf 'EVENT😀\\n'; printf 'ERROR中文\\n' >&2;"} ${mode === "rearm" ? "while [ ! -f rearm.resume ]; do sleep 0.02; done; printf 'RESUME_ONLY\n'; while [ ! -f rearm.user ]; do sleep 0.02; done; printf 'FUTURE\n'; " : ""}while [ ! -f ${mode}.finish ]; do sleep 0.02; done; printf TAIL`,
          description: `Native Monitor ${mode}`,
          persistent: mode !== "timeout",
          timeout_ms: mode === "timeout" ? 600 : 0,
        },
      }
    if (current.calls === 2 && ["wait", "cancel"].includes(mode)) {
      const id = JSON.stringify(input).match(/proc_[A-Za-z0-9]{26}/)?.[0]
      assert.ok(id)
      if (mode === "cancel") await current.active.promise
      return { tool: mode === "wait" ? "process_wait" : "process_cancel", args: { process_id: id, timeout_ms: 15000 } }
    }
    if (current.calls === 2 && ["active", "stop", "rearm"].includes(mode)) await current.active.promise
    return { content: `PARENT_${mode}_${current.calls}` }
  },
})
const owned = []
const create = async (id) =>
  (
    await fixture.api("/api/session", {
      ...(id ? { id } : {}),
      location: { directory: fixture.directory },
      agent: "build",
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
const list = (id) => fixture.api(`/api/session/${id}/process`)
const detail = (id, process) => fixture.api(`/api/session/${id}/process/${process}`)
const release = (mode, phase) => writeFile(join(fixture.directory, `${mode}.${phase}`), "go")
const settled = (id) => fixture.api(`/api/session/${id}/wait`, undefined, "POST")
const messages = async (id) => {
  const response = await fetch(
    `${fixture.url}/api/session/${id}/message?order=asc&directory=${encodeURIComponent(fixture.directory)}`,
  )
  assert.equal(response.status, 200)
  return (await response.json()).data
}
try {
  const config = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/xai",
            url: config.provider.xai.options.baseURL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "grok-4.7": {
              name: "Fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  for (const mode of ["idle", "active", "wait", "cancel", "stop", "rearm", "delete", "timeout", "overload"]) {
    const parent = await create(),
      current = state(mode)
    await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: `MONITOR_NATIVE_${mode}` } })
    await poll(() => current.calls >= 2, `${mode} initial continuation`)
    const receipt = await poll(async () => (await list(parent.id))[0], `${mode} receipt`)
    owned.push({ session: parent.id, id: receipt.id, mode })
    assert.equal(receipt.kind, "monitor")
    assert.equal(receipt.monitor.persistent, mode !== "timeout")
    const pid = Number(
      await poll(
        async () => readFile(join(fixture.directory, `${mode}.pid`), "utf8").catch(() => undefined),
        "spawn PID",
      ),
    )
    if (mode === "delete") {
      await settled(parent.id)
      await fixture.api(`/api/session/${parent.id}`, undefined, "DELETE")
      assert.throws(() => process.kill(pid, 0))
      await create(parent.id)
      assert.deepEqual(await list(parent.id), [])
      assert.equal(current.events, 0)
      checks.push("deletion-joins-and-fences-reused-session")
      continue
    }
    if (["stop", "rearm"].includes(mode)) {
      await fixture.api(`/api/session/${parent.id}/interrupt`, undefined, "POST")
      current.active.resolve()
      await settled(parent.id)
    }
    if (["timeout", "overload"].includes(mode)) {
      const terminal = await poll(
        async () => {
          const value = await detail(parent.id, receipt.id)
          return value.status !== "running" && value
        },
        `${mode} terminal`,
        45000,
      )
      await poll(() => current.completions === 1, `${mode} one terminal delivery`)
      await settled(parent.id)
      assert.equal(terminal.status, "failed")
      assert.equal(terminal.monitor.overloaded, mode === "overload")
      assert.throws(() => process.kill(pid, 0))
      checks.push(`${mode}-actual-process-settlement`)
      continue
    }
    if (mode === "cancel") {
      assert.doesNotThrow(() => process.kill(pid, 0))
      current.active.resolve()
      await settled(parent.id)
      assert.equal((await detail(parent.id, receipt.id)).status, "cancelled")
      assert.equal(current.events, 0)
      assert.equal(current.completions, 0)
      assert.throws(() => process.kill(pid, 0))
      checks.push("model-cancel-joins-without-reminder")
      continue
    }
    if (mode === "idle") {
      await settled(parent.id)
      const before = current.calls
      assert.equal(
        (await fixture.api(`/api/session/${parent.id}/process/${receipt.id}/wait`, { timeoutMs: 0 })).timedOut,
        true,
      )
      assert.equal(current.calls, before)
    }
    await release(mode, "event")
    await poll(
      async () => (await detail(parent.id, receipt.id)).output.includes(mode === "idle" ? "😀" : "EVENT😀"),
      `${mode} live preview`,
    )
    if (mode === "active") {
      assert.equal(current.calls, 2)
      current.active.resolve()
    }
    if (mode === "rearm") {
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(current.events, 0)
      assert.equal(
        (await fixture.api(`/api/session/${parent.id}/process/${receipt.id}/wait`, { timeoutMs: 0 })).timedOut,
        true,
      )
      await settled(parent.id)
      await release(mode, "resume")
      await poll(async () => (await detail(parent.id, receipt.id)).output.includes("RESUME_ONLY"), "resume-only output")
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(current.events, 0)
      await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "Continue watching future lines." } })
      await settled(parent.id)
      await release(mode, "user")
    }
    if (mode === "idle")
      await poll(
        () => current.eventText.includes("EVENT😀") && current.eventText.includes("ERROR中文"),
        "both independent Monitor pipes delivered intact",
      )
    if (!["idle", "stop", "wait"].includes(mode)) await poll(() => current.events === 1, `${mode} one live event`)
    await release(mode, "finish")
    assert.equal(
      (await fixture.api(`/api/session/${parent.id}/process/${receipt.id}/wait`, { timeoutMs: 10000 })).process.status,
      "completed",
    )
    if (!["stop", "wait"].includes(mode)) await poll(() => current.completions === 1, `${mode} terminal delivery`)
    await settled(parent.id)
    assert.equal(current.completions, ["stop", "wait"].includes(mode) ? 0 : 1)
    if (mode === "idle") assert.ok(current.events >= 1)
    if (mode !== "idle") assert.equal(current.events, ["stop", "wait"].includes(mode) ? 0 : 1)
    assert.equal(
      (await messages(parent.id)).filter((message) => message.type === "user").length,
      mode === "rearm" ? 2 : 1,
    )
    checks.push(`${mode}-owned-monitor-lifecycle`)
  }
  const parent = await create(),
    current = state("restart")
  await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "MONITOR_NATIVE_restart" } })
  await settled(parent.id)
  const receipt = (await list(parent.id))[0]
  owned.push({ session: parent.id, id: receipt.id, mode: "restart" })
  const before = calls.length
  await fixture.crash()
  await release("restart", "event")
  await release("restart", "finish")
  await fixture.reopen()
  const interrupted = await detail(parent.id, receipt.id)
  assert.equal(interrupted.status, "interrupted")
  assert.equal(interrupted.blockedReason, "process_restart")
  assert.equal(calls.length, before)
  assert.equal(current.events, 0)
  checks.push("restart-passive-receipt-without-replay")
  console.log(JSON.stringify({ checks, calls: calls.length, output: fixture.output }))
} finally {
  for (const current of states.values()) current.active.resolve()
  for (const value of owned) {
    await release(value.mode, "event")
    await release(value.mode, "finish")
    await fixture.api(`/api/session/${value.session}/process/${value.id}/cancel`, undefined, "POST").catch(() => {})
  }
  await release("rearm", "resume")
  await release("rearm", "user")
  await writeFile(join(fixture.output, "monitor-report.json"), JSON.stringify({ checks, calls }, null, 2))
  await fixture.close()
}
