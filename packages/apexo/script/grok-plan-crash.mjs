import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFile, readdir } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const results = []
for (const stage of ["decision", "tool"]) {
  let turn = 0
  const runtime = await startShellFixture("cli", {
    config: { snapshot: false },
    env: { PLAN_CRASH_STAGE: stage },
    bunArgs: ["--preload", fileURLToPath(new URL("./grok-plan-crash-preload.ts", import.meta.url))],
    next: () =>
      ++turn === 1
        ? { tool: "plan_enter", args: {} }
        : turn === 2
          ? { tool: "plan_exit", args: {} }
          : { content: "RECOVERED_APPROVAL" },
  })
  try {
    await writeFile(join(runtime.directory, "apexo.json"), runtime.env.APEXO_CONFIG_CONTENT)
    const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
      const result = await fetch(new URL(route, runtime.url), {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
      })
      const text = await result.text()
      assert.ok(result.ok, `${result.status}: ${text}`)
      return text ? JSON.parse(text) : undefined
    }
    const session = (
      await request("/api/session", {
        location: { directory: runtime.directory },
        agent: "build",
        model: { providerID: "xai", id: "grok-4.7" },
      })
    ).data
    const root = `/api/session/${session.id}`
    await request(`${root}/prompt`, { id: "msg_plan_crash_origin", prompt: { text: "Prepare a plan" } })
    const pending = await poll(async () => (await request(`${root}/question`)).data[0], "original pending Plan review")
    const response = request(`${root}/question/${pending.id}/reply`, { answers: [["Approve"]] }).then(
      () => "completed",
      () => "interrupted",
    )
    const checkpoint = join(runtime.env.XDG_STATE_HOME, "plan-crash-reached.json")
    await poll(async () => await Bun.file(checkpoint).exists(), `durable ${stage} boundary`)
    assert.equal(runtime.calls.length, 2)
    await runtime.crash()
    await response
    await runtime.reopen()
    assert.equal((await request(root)).data.agent, "build")
    assert.deepEqual((await request(`${root}/question`)).data, [])
    assert.equal(runtime.calls.length, 2)
    await request(`${root}/question/${pending.id}/reply`, { answers: [["Approve"]] })
    await request(`${root}/wait`, undefined, "POST")
    assert.equal(runtime.calls.length, 2, "exact answer retry must not restart provider work after crash")
    await request(`${root}/prompt`, { id: "msg_plan_crash_continue", prompt: { text: "Continue the approved plan" } })
    await request(`${root}/wait`, undefined, "POST")
    assert.equal(runtime.calls.length, 3)
    const messages = (await request(`${root}/message?order=asc`)).data
    assert.equal(messages.filter((message) => message.type === "user").length, 2, "only genuine user admissions")
    const original = messages.find((message) => message.id === pending.tool.messageID)
    assert.equal(
      original.content.find((part) => part.type === "tool" && part.id === pending.tool.callID).state.status,
      "completed",
    )
    const files = await readdir(join(runtime.env.XDG_DATA_HOME, "apexo"))
    const db = new Database(
      join(
        runtime.env.XDG_DATA_HOME,
        "apexo",
        files.find((name) => name.endsWith(".db")),
      ),
      { readonly: true },
    )
    try {
      const events = db
        .query("SELECT type, data FROM event WHERE aggregate_id = ? ORDER BY seq")
        .all(session.id)
        .map((row) => ({ type: row.type, data: JSON.parse(row.data) }))
      const originalEvents = events.filter((event) => event.data.assistantMessageID === pending.tool.messageID)
      assert.equal(
        originalEvents.filter(
          (event) => event.type.startsWith("session.next.tool.success.") && event.data.callID === pending.tool.callID,
        ).length,
        1,
      )
      assert.equal(originalEvents.filter((event) => event.type.startsWith("session.next.step.ended.")).length, 1)
      const receipt = JSON.parse(db.query("SELECT data FROM session_plan_receipt WHERE id = ?").get(pending.id).data)
      assert.equal(receipt.decision, "approved")
      assert.equal(receipt.settled, true)
    } finally {
      db.close()
    }
    results.push({ stage, passed: 5, providerCalls: runtime.calls.length, output: runtime.output })
  } finally {
    await runtime.close()
  }
}
console.log(JSON.stringify({ passed: results.reduce((total, item) => total + item.passed, 0), results }, null, 2))
