import assert from "node:assert/strict"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

const admitted = Promise.withResolvers()
const admissionRelease = Promise.withResolvers()
const newerArrived = Promise.withResolvers()
const newerRelease = Promise.withResolvers()
const fixture = await startPlanUiFixture({
  next: async ({ text, finished }) => {
    if (text.includes("NEWER_UNRELATED")) {
      newerArrived.resolve()
      await newerRelease.promise
      return { content: "UNRELATED_MUST_NOT_APPEAR" }
    }
    if (text.includes("STEER_OLD") && !finished)
      return {
        tool: "bash",
        args: {
          command: "echo $$ > steer.pid; while [ ! -f steer.release ]; do sleep 0.02; done; printf OWNED_TOOL_FINISHED",
          description: "Held boundary",
        },
      }
    return { content: "UNEXPECTED_PROVIDER_WORK" }
  },
})
const runtime = fixture.runtime
const requests = []
const state = { rejectInterrupt: false }
const proxy = createServer(async (incoming, outgoing) => {
  const owner = new AbortController()
  outgoing.on("close", () => owner.abort())
  try {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    const body = bytes.length ? JSON.parse(bytes.toString()) : undefined
    requests.push({ method: incoming.method, path: incoming.url, body })
    if (state.rejectInterrupt && incoming.url.endsWith("/execution/interrupt")) {
      outgoing.writeHead(503, { "content-type": "application/json" })
      outgoing.end(JSON.stringify({ message: "Fixture cancellation transport unavailable" }))
      return
    }
    const response = await fetch(new URL(incoming.url, runtime.url), {
      method: incoming.method,
      headers: bytes.length ? { "content-type": "application/json" } : undefined,
      body: bytes.length ? bytes : undefined,
      signal: owner.signal,
    })
    if (body?.resume === false && body.prompt?.text === "WITHDRAW_BEFORE_WAKE") {
      admitted.resolve({ sessionID: incoming.url.split("/")[3], inputID: body.id })
      await admissionRelease.promise
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) for await (const chunk of response.body) outgoing.write(chunk)
    outgoing.end()
  } catch (error) {
    if (!owner.signal.aborted) outgoing.destroy(error)
  }
})
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve))
const url = `http://127.0.0.1:${proxy.address().port}`
const children = []
const start = (text, sessionID) => {
  const child = Bun.spawn(
    [
      ...(process.env.APEXO_TEST_CLI_BIN
        ? [process.env.APEXO_TEST_CLI_BIN]
        : [process.execPath, resolve("src/index.ts")]),
      "run",
      "--session-protocol",
      "native",
      "--attach",
      url,
      "--dir",
      runtime.directory,
      "--model",
      "xai/grok-4.7",
      "--format",
      "json",
      "--auto",
      ...(sessionID ? ["--session", sessionID] : []),
      text,
    ],
    { env: runtime.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  )
  children.push(child)
  return {
    child,
    result: Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
  }
}
try {
  const pending = start("WITHDRAW_BEFORE_WAKE")
  const target = await deadline(admitted.promise, 30000, "committed admit-only input")
  assert.equal(runtime.calls.length, 0)
  pending.child.kill("SIGINT")
  admissionRelease.resolve()
  const [code, stdout, stderr] = await deadline(pending.result, 20000, "withdrawal settlement")
  await Bun.write(join(runtime.output, "withdraw.json"), JSON.stringify({ code, stdout, stderr }, null, 2))
  assert.equal(code, 130, stderr)
  const receipt = stdout
    .trim()
    .split("\n")
    .map(JSON.parse)
    .find((event) => event.type === "input_execution")
  assert.equal(receipt.reason, "withdrawn")
  assert.equal(runtime.calls.length, 0)
  assert.equal(requests.filter((request) => request.path.includes("/prompt")).length, 1)
  const history = await fixture.api(`/api/session/${target.sessionID}/history?limit=100`)
  assert.equal(history.data.filter((event) => event.type === "session.next.prompted").length, 0)

  const session = (
    await fixture.api("/api/session", {
      location: { directory: runtime.directory },
      model: { providerID: "xai", id: "grok-4.7" },
    })
  ).data
  const older = start("STEER_OLD", session.id)
  await poll(() => Bun.file(join(runtime.directory, "steer.pid")).exists(), "owned first-turn process", 20000)
  await fixture.api(`/api/session/${session.id}/prompt`, { prompt: { text: "NEWER_UNRELATED" } })
  await Bun.write(join(runtime.directory, "steer.release"), "release")
  await deadline(newerArrived.promise, 20000, "newer provider arrival")
  const [status, output, diagnostic] = await deadline(
    older.result,
    10000,
    "older result independent of held newer provider",
  )
  await Bun.write(join(runtime.output, "superseded.json"), JSON.stringify({ status, output, diagnostic }, null, 2))
  assert.equal(status, 1, diagnostic)
  const terminal = output
    .trim()
    .split("\n")
    .map(JSON.parse)
    .find((event) => event.type === "input_execution")
  assert.equal(terminal.status, "superseded")
  assert.ok(output.includes("OWNED_TOOL_FINISHED"))
  assert.ok(!output.includes("UNRELATED_MUST_NOT_APPEAR"))
  newerRelease.resolve()
  await poll(
    async () => !(await fixture.api("/api/session/active")).data[session.id],
    "newer ordinary drain settles",
    10000,
  )
  await Bun.file(join(runtime.directory, "steer.pid")).delete()
  await Bun.file(join(runtime.directory, "steer.release")).delete()
  const unavailable = start("STEER_OLD", session.id)
  await poll(
    () => Bun.file(join(runtime.directory, "steer.pid")).exists(),
    "remote held process for unavailable cancel",
    20000,
  )
  state.rejectInterrupt = true
  unavailable.child.kill("SIGTERM")
  const [unconfirmedCode, unconfirmedOutput, unconfirmedError] = await deadline(
    unavailable.result,
    20000,
    "unconfirmed cancellation result",
  )
  await Bun.write(
    join(runtime.output, "unconfirmed.json"),
    JSON.stringify({ code: unconfirmedCode, stdout: unconfirmedOutput, stderr: unconfirmedError }, null, 2),
  )
  assert.equal((await fixture.api("/api/session/active")).data[session.id] !== undefined, true)
  const remotePID = Number(await Bun.file(join(runtime.directory, "steer.pid")).text())
  process.kill(remotePID, 0)
  await fixture.api(`/api/session/${session.id}/interrupt`, undefined, "POST")
  assert.throws(() => process.kill(remotePID, 0))
  assert.equal(unconfirmedCode, 1, unconfirmedError)
  assert.ok(unconfirmedError.includes("cleanup is unconfirmed"))
  assert.ok(!unconfirmedOutput.includes('"type":"input_execution"'))
  console.log(
    JSON.stringify({
      checks: 3,
      providerCalls: runtime.calls.length,
      withdrawal: receipt.reason,
      older: terminal.status,
    }),
  )
} finally {
  admissionRelease.resolve()
  newerRelease.resolve()
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
  proxy.closeAllConnections()
  await new Promise((resolve) => proxy.close(resolve))
  await fixture.close()
  console.error(`Native headless race evidence: ${runtime.output}`)
}
