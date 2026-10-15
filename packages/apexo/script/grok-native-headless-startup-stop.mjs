import assert from "node:assert/strict"
import { createServer } from "node:http"
import { join, resolve } from "node:path"
import { startPlanUiFixture } from "./grok-plan-ui-fixture.mjs"
import { deadline } from "./grok-shell-fixture.mjs"

const fixture = await startPlanUiFixture({
  next: () => {
    throw new Error("Stopped startup must not call provider")
  },
})
const runtime = fixture.runtime
const cases = []
try {
  for (const mode of ["catalog", "admitted", "unknown"]) {
    const arrived = Promise.withResolvers()
    const release = Promise.withResolvers()
    const committed = Promise.withResolvers()
    const state = { target: undefined }
    const proxy = createServer(async (incoming, outgoing) => {
      const owner = new AbortController()
      outgoing.on("close", () => owner.abort())
      try {
        const chunks = []
        for await (const chunk of incoming) chunks.push(chunk)
        const bytes = Buffer.concat(chunks)
        const body = bytes.length ? JSON.parse(bytes.toString()) : undefined
        const pathname = new URL(incoming.url, runtime.url).pathname
        if (mode === "catalog" && pathname === "/api/agent") {
          arrived.resolve()
          await release.promise
        }
        if (mode === "unknown" && body?.resume === false) {
          state.target = { sessionID: pathname.split("/")[3], inputID: body.id }
          arrived.resolve()
          await release.promise
        }
        const response = await fetch(new URL(incoming.url, runtime.url), {
          method: incoming.method,
          headers: bytes.length ? { "content-type": "application/json" } : undefined,
          body: bytes.length ? bytes : undefined,
          signal: mode === "unknown" && body?.resume === false ? undefined : owner.signal,
        })
        if (mode === "admitted" && body?.resume === false) {
          state.target = { sessionID: pathname.split("/")[3], inputID: body.id }
          assert.equal(response.status, 200)
          arrived.resolve()
          await release.promise
        }
        if (mode === "unknown" && body?.resume === false) {
          assert.equal(response.status, 200)
          committed.resolve()
          await response.body?.cancel()
          return
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        if (response.body) for await (const chunk of response.body) outgoing.write(chunk)
        outgoing.end()
      } catch (error) {
        if (!owner.signal.aborted) outgoing.destroy(error)
      }
    })
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve))
    const child = Bun.spawn(
      [
        ...(process.env.APEXO_TEST_CLI_BIN
          ? [process.env.APEXO_TEST_CLI_BIN]
          : [process.execPath, resolve("src/index.ts")]),
        "run",
        "--session-protocol",
        "native",
        "--attach",
        `http://127.0.0.1:${proxy.address().port}`,
        "--dir",
        runtime.directory,
        "--model",
        "xai/grok-4.7",
        "--format",
        "json",
        "STOP_BEFORE_PROVIDER",
      ],
      { env: runtime.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    )
    const captured = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    try {
      await deadline(arrived.promise, 30000, `held ${mode} request`)
      const started = Date.now()
      child.kill("SIGTERM")
      const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(12000).then(() => false)])
      const elapsed = Date.now() - started
      if (!stopped) child.kill("SIGKILL")
      const code = await child.exited
      const [stdout, stderr] = await captured
      cases.push({ mode, stopped, code, elapsed, stdout, stderr })
      if (mode === "unknown") {
        release.resolve()
        await deadline(committed.promise, 10000, "late canonical admission")
        assert.equal(code, 1)
        assert.ok(stderr.includes("cleanup is unconfirmed"))
      }
      if (state.target) {
        const target = state.target
        const receipt = await fixture.api(`/api/session/${target.sessionID}/input/${target.inputID}/execution`)
        cases.at(-1).receipt = receipt
        assert.equal(receipt.data.reason, mode === "admitted" ? "withdrawn" : undefined)
        if (mode === "unknown") assert.equal(receipt.data.status, "admitted")
        await fixture.api(
          `/api/session/${target.sessionID}/input/${target.inputID}/execution/interrupt`,
          undefined,
          "POST",
        )
      }
    } finally {
      release.resolve()
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
      proxy.closeAllConnections()
      await new Promise((resolve) => proxy.close(resolve))
    }
  }
  await Bun.write(join(runtime.output, "startup-stop.json"), JSON.stringify(cases, null, 2))
  console.log(JSON.stringify({ cases, providerCalls: runtime.calls.length }))
  assert.ok(
    cases.every((item) => item.stopped),
    "signal shutdown must be bounded while startup HTTP is held",
  )
  assert.ok(
    cases.every((item) => item.code === (item.mode === "unknown" ? 1 : 143)),
    "known pre-admission or withdrawn input cleanup must settle",
  )
  assert.equal(runtime.calls.length, 0)
} finally {
  await fixture.close()
  console.error(`Headless startup-stop evidence: ${runtime.output}`)
}
