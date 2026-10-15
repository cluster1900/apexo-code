import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { restoreSession, restorationMessage, SessionRestorationError } from "../session-restore"

// Keep HTTP requests and cancellation in one native realm under the App's DOM preload.
const received = Promise.withResolvers<void>()
const calls: string[] = []
const bodies: string[] = []
const server = createServer((request, response) => {
  calls.push(`${request.method} ${request.url}`)
  bodies.push(request.headers["content-length"] ?? "absent")
  if (request.url?.includes("held")) {
    received.resolve()
    return
  }
  if (request.url?.includes("failed")) {
    response
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ cause: "private backend diagnostic" }))
    return
  }
  response.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({
      sessionID: "intended",
      schedules: [{ id: "intent", reason: "permission_required" }],
    }),
  )
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("Missing fixture address")
const owner = new AbortController()
try {
  const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, throwOnError: true })
  const protocol = Promise.withResolvers<"v2">()
  const target = { client, protocol: protocol.promise, sessionID: "intended" }
  const pending = restoreSession(target, owner.signal)
  target.sessionID = "later-tab"
  target.client = createApexoClient({ baseUrl: "http://127.0.0.1:1", throwOnError: true })
  protocol.resolve("v2")
  const result = await pending
  assert.equal(result?.sessionID, "intended")
  assert.equal(restorationMessage(result), "session.restore.permissionRequired")
  assert.deepEqual(calls, ["POST /api/session/intended/restore"])
  assert.equal(
    await restoreSession({ client, protocol: Promise.resolve("v1"), sessionID: "compatibility" }, owner.signal),
    undefined,
  )
  assert.equal(calls.length, 1)
  const failed = await restoreSession(
    { client, protocol: Promise.resolve("v2"), sessionID: "failed" },
    owner.signal,
  ).catch((error: unknown) => error)
  assert(failed instanceof SessionRestorationError)
  assert(!failed.message.includes("private backend diagnostic"))
  const rejected = await restoreSession(
    { client, protocol: Promise.reject(new Error("private health diagnostic")), sessionID: "intended" },
    owner.signal,
  ).catch((error: unknown) => error)
  assert(rejected instanceof SessionRestorationError)
  const held = restoreSession({ client, protocol: Promise.resolve("v2"), sessionID: "held" }, owner.signal).catch(
    (error: unknown) => error,
  )
  await received.promise
  owner.abort()
  assert((await held) instanceof SessionRestorationError)
  assert.deepEqual(calls, [
    "POST /api/session/intended/restore",
    "POST /api/session/failed/restore",
    "POST /api/session/held/restore",
  ])
  assert(bodies.every((body) => body === "absent" || body === "0"))
  console.log("Explicit restoration identity, compatibility, safe errors and cancellation verified")
} finally {
  owner.abort()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
