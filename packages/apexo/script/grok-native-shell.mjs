// Real native Session shell tools and passive process API, using an isolated CLI or packaged Desktop backend.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const checks = [],
  calls = [],
  states = new Map()
const state = (mode) => {
  if (!states.has(mode)) states.set(mode, { calls: 0, notices: 0, active: Promise.withResolvers() })
  return states.get(mode)
}
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  next: async ({ input, text, ancillary }) => {
    if (ancillary) return { content: "Native shell acceptance" }
    const mode = (text.match(/SHELL_NATIVE_(idle|active|wait|cancel|stop|delete|failure|timed|restart|refuse)/) ??
      JSON.stringify(input).match(
        /SHELL_NATIVE_(idle|active|wait|cancel|stop|delete|failure|timed|restart|refuse)/,
      ))?.[1]
    assert.ok(mode, "Expected the original native shell scenario marker")
    const current = state(mode)
    current.calls++
    calls.push({ mode, turn: current.calls })
    if (JSON.stringify(input).includes("Background shell completion data follows")) {
      current.notices++
      assert.match(JSON.stringify(input), mode === "failure" ? /failed/ : /BEGIN😀END/)
      return { content: `NOTICE_DONE_${mode}` }
    }
    if (current.calls === 1) {
      if (mode === "refuse") return { tool: "process_wait", args: { process_id: state("restart").id, timeout_ms: 10 } }
      return {
        tool: "bash",
        args: {
          command:
            mode === "failure"
              ? "printf FAILURE; exit 7"
              : `echo $$ > ${mode}.pid; printf 'BEGIN😀'; while [ ! -f ${mode}.release ]; do sleep 0.02; done; printf END`,
          description: `Owned shell ${mode}`,
          timeout: 60000,
          ...(mode === "timed" ? { block_until_ms: 100 } : { background: true }),
        },
      }
    }
    if (current.calls === 2 && ["wait", "cancel"].includes(mode)) {
      const id = JSON.stringify(input).match(/proc_[A-Za-z0-9]{26}/)?.[0]
      assert.ok(id)
      return { tool: mode === "wait" ? "process_wait" : "process_cancel", args: { process_id: id, timeout_ms: 15000 } }
    }
    if (["active", "stop"].includes(mode)) await current.active.promise
    if (mode === "refuse") assert.match(JSON.stringify(input), /interrupted|process_restart/)
    return { content: `PARENT_DONE_${mode}` }
  },
})
const create = async (id) =>
  (
    await fixture.api("/api/session", {
      ...(id ? { id } : {}),
      location: { directory: fixture.directory },
      model: { providerID: "xai", id: "grok-4.7" },
      agent: "build",
    })
  ).data
const list = (id) => fixture.api(`/api/session/${id}/process`)
const output = (session, id) => fixture.api(`/api/session/${session}/process/${id}`)
const wait = (session, id) => fixture.api(`/api/session/${session}/process/${id}/wait`, { timeoutMs: 15000 })
const messages = async (id) => {
  const response = await fetch(
    `${fixture.url}/api/session/${id}/message?order=asc&directory=${encodeURIComponent(fixture.directory)}`,
  )
  assert.equal(response.status, 200)
  return (await response.json()).data
}
const done = (id, marker) =>
  poll(
    async () =>
      (await messages(id)).some(
        (message) =>
          message.type === "assistant" &&
          message.content.some((part) => part.type === "text" && part.text.includes(marker)),
      ),
    marker,
    20000,
  )
const release = (mode) => writeFile(join(fixture.directory, `${mode}.release`), "ready")
const owned = []
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
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const foreign = await create()
  for (const mode of ["idle", "active", "wait", "cancel", "stop", "delete", "failure", "timed"]) {
    const parent = await create(),
      current = state(mode)
    await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: `SHELL_NATIVE_${mode}` } })
    await poll(() => current.calls >= 2, `${mode} parent continuation`)
    const receipt = await poll(async () => (await list(parent.id))[0], `${mode} process receipt`)
    owned.push({ session: parent.id, id: receipt.id, mode })
    assert.equal(receipt.kind, "shell")
    if (mode !== "failure") assert.equal(receipt.background, true)
    assert.equal((await fetch(`${fixture.url}/api/session/${foreign.id}/process/${receipt.id}`)).status, 404)
    if (mode === "delete") {
      await done(parent.id, "PARENT_DONE_delete")
      await fixture.api(`/api/session/${parent.id}`, undefined, "DELETE")
      assert.equal((await fetch(`${fixture.url}/api/session/${parent.id}/process/${receipt.id}`)).status, 404)
      await create(parent.id)
      assert.deepEqual(await list(parent.id), [])
      assert.equal(current.notices, 0)
      checks.push("deletion-joins-process-and-fences-reused-session")
      continue
    }
    if (mode === "stop") await fixture.api(`/api/session/${parent.id}/interrupt`, undefined, "POST")
    if (["idle", "timed"].includes(mode)) {
      await done(parent.id, `PARENT_DONE_${mode}`)
      const before = current.calls
      assert.equal(
        (await fixture.api(`/api/session/${parent.id}/process/${receipt.id}/wait`, { timeoutMs: 0 })).timedOut,
        true,
      )
      assert.equal(current.calls, before)
      const pid = Number(await readFile(join(fixture.directory, `${mode}.pid`), "utf8"))
      process.kill(pid, 0)
    }
    await release(mode)
    const result = await wait(parent.id, receipt.id)
    assert.equal(result.process.status, mode === "cancel" ? "cancelled" : mode === "failure" ? "failed" : "completed")
    if (mode === "active") assert.equal(current.calls, 2)
    current.active.resolve()
    if (["idle", "active", "timed"].includes(mode)) await done(parent.id, `NOTICE_DONE_${mode}`)
    if (["wait", "cancel", "failure"].includes(mode))
      await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
    await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
    assert.equal((await messages(parent.id)).filter((message) => message.type === "user").length, 1)
    if (["idle", "active", "timed"].includes(mode)) assert.equal(current.notices, 1)
    if (["stop", "wait", "cancel"].includes(mode)) assert.equal(current.notices, 0)
    checks.push(`${mode}-native-owned-process-lifecycle`)
  }
  const parent = await create(),
    current = state("restart")
  await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "SHELL_NATIVE_restart" } })
  await done(parent.id, "PARENT_DONE_restart")
  current.id = (await list(parent.id))[0].id
  owned.push({ session: parent.id, id: current.id, mode: "restart" })
  const before = calls.length
  await fixture.crash()
  await release("restart")
  await fixture.reopen()
  const completed = owned.find((item) => item.mode === "idle")
  assert.ok(completed)
  assert.equal((await output(completed.session, completed.id)).status, "completed")
  assert.equal(
    (await fetch(`${fixture.url}/api/session/${completed.session}/process/${completed.id}/cancel`, { method: "POST" }))
      .status,
    204,
    "Cancelling a completed pre-restart receipt must remain idempotent",
  )
  assert.equal(
    (await fetch(`${fixture.url}/api/session/${completed.session}/process/${completed.id}/cancel`, { method: "POST" }))
      .status,
    204,
    "Repeated completed-receipt cancellation remains idempotent",
  )
  assert.equal((await output(completed.session, completed.id)).status, "completed")
  assert.equal(calls.length, before)
  const interrupted = await output(parent.id, current.id)
  assert.equal(interrupted.status, "interrupted")
  assert.equal(interrupted.blockedReason, "process_restart")
  await fixture.api(`/api/session/${parent.id}/wait`, undefined, "POST")
  assert.equal(calls.length, before)
  await fixture.api(`/api/session/${parent.id}/prompt`, { prompt: { text: "SHELL_NATIVE_refuse" } })
  await done(parent.id, "PARENT_DONE_refuse")
  assert.equal((await output(parent.id, current.id)).status, "interrupted")
  checks.push("restart-passive-read-and-wait-never-respawn-or-replay")
  console.log(JSON.stringify({ checks, providerCalls: calls.length, output: fixture.output }, null, 2))
} finally {
  for (const [mode, current] of states) {
    current.active.resolve()
    await release(mode)
  }
  for (const item of owned)
    await fixture.api(`/api/session/${item.session}/process/${item.id}/cancel`, undefined, "POST").catch(() => {})
  await fixture.close()
  await writeFile(join(fixture.output, "native-shell.json"), JSON.stringify({ checks, calls }, null, 2))
}
