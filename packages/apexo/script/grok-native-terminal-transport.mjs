import assert from "node:assert/strict"
import { createApexoClient } from "@apexo/sdk/v2"
import { sessionTransport } from "@apexo/tui/transport/session"
import { validateSession } from "../src/cli/tui/validate-session"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
import { poll } from "./grok-shell-fixture.mjs"

const fixture = await startPlanUiFixture()
const controller = new AbortController()
const events = []
let listening
const checks = []
try {
  const client = createApexoClient({ baseUrl: fixture.runtime.url, directory: fixture.runtime.directory })
  const transport = await sessionTransport(client, fixture.runtime.directory)(controller.signal)
  assert.equal(transport.kind, "native")
  const catalog = await transport.catalog(controller.signal)
  assert.ok(catalog.agents.some((item) => item.id === "build"))
  assert.ok(catalog.models.some((item) => item.id === "grok-4.7"))
  checks.push("real native catalogs and protocol selection")
  const connected = await transport.subscribe(controller.signal)
  listening = (async () => {
    for await (const event of connected.stream) events.push(event)
  })()
  listening.catch(() => {})
  await poll(() => events.some((event) => event.type === "server.connected"), "native subscription readiness")
  const prepared = await fixture.prepare("ordinary")
  await validateSession({
    url: fixture.runtime.url,
    directory: fixture.runtime.directory,
    sessionID: prepared.session.id,
  })
  const pending = await transport.questions(prepared.session.id, controller.signal)
  assert.equal(pending[0].id, prepared.question.id)
  await transport.replyQuestion(
    { sessionID: prepared.session.id, requestID: pending[0].id, questionV2Reply: { answers: [["First"]] } },
    controller.signal,
  )
  await poll(async () => {
    const view = await transport.history(prepared.session.id, controller.signal)
    return view
      .snapshot()
      .some((row) => row.parts.some((part) => part.type === "text" && part.text === "ORDINARY_QUESTION_DONE"))
  }, "native replay after actual Question approval")
  checks.push("native Session validation, original owned Question reply and durable replay")
  const fresh = await transport.create(
    { agent: "build", model: { providerID: "xai", id: "grok-4.7" } },
    controller.signal,
  )
  const admitted = await transport.admit(
    { sessionID: fresh.id, prompt: { text: "NATIVE_TERMINAL_PROMPT" } },
    controller.signal,
  )
  assert.equal(admitted.sessionID, fresh.id)
  await poll(async () => {
    const view = await transport.history(fresh.id, controller.signal)
    return view
      .snapshot()
      .some((row) => row.parts.some((part) => part.type === "text" && part.text === "ORDINARY_QUESTION_DONE"))
  }, "native transport prompt settlement")
  assert.ok(events.some((event) => event.type === "session.next.text.ended" && event.data.sessionID === fresh.id))
  checks.push("actual native durable prompt and SSE use the same canonical identities")
  const calls = fixture.runtime.calls.length
  await transport.get(fresh.id, controller.signal)
  await transport.history(fresh.id, controller.signal)
  await transport.interrupt(fresh.id, controller.signal)
  assert.equal(fixture.runtime.calls.length, calls)
  checks.push("passive reads and idle interrupt do not schedule model work")
  console.log(
    JSON.stringify({ checks, providerCalls: fixture.runtime.calls.length, output: fixture.runtime.output }, null, 2),
  )
} finally {
  controller.abort()
  await listening?.catch(() => {})
  await fixture.close()
}
