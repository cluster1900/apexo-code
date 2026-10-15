import assert from "node:assert/strict"
import { resolve } from "node:path"
import { Rpc } from "../src/util/rpc"
import { startShellFixture, deadline } from "./grok-shell-fixture.mjs"

const runtime = await startShellFixture("cli", { deferBackend: true })
const worker = new Worker(resolve("src/cli/tui/worker.ts"), {
  env: { ...runtime.env, APEXO_NATIVE_TUI_HOST: "1" },
})
const client = Rpc.client(worker)
const owner = new AbortController()
try {
  const transport = await deadline(client.call("start", undefined), 20000, "native worker startup")
  assert.equal(transport.ok, true)
  const url = new URL(transport.url)
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal((await fetch(`${url}api/session`)).status, 401)
  assert.equal((await fetch(`${url}api/session`, { headers: { Authorization: "Basic invalid" } })).status, 401)
  const response = await fetch(`${url}api/session`, { headers: transport.headers })
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data, [])
  const stream = await fetch(`${url}api/event`, { headers: transport.headers, signal: owner.signal })
  assert.equal(stream.status, 200)
  assert.match(stream.headers.get("content-type"), /text\/event-stream/)
  const reader = stream.body.getReader()
  const first = await deadline(reader.read(), 5000, "native worker SSE opening")
  assert.equal(first.done, false)
  assert.ok(new TextDecoder().decode(first.value).length > 0)
  owner.abort()
  await reader.cancel().catch(() => undefined)
  assert.equal((await deadline(client.call("shutdown", undefined), 10000, "native worker joined shutdown")).ok, true)
  assert.equal(
    await fetch(`${url}api/session`, { headers: transport.headers }).then(
      () => true,
      () => false,
    ),
    false,
  )
  assert.equal(runtime.calls.length, 0)
  console.log(JSON.stringify({ checks: 7, providerCalls: 0 }))
} finally {
  owner.abort()
  await deadline(client.call("shutdown", undefined), 10000, "native worker cleanup").catch(() => undefined)
  worker.terminate()
  await runtime.close()
}
