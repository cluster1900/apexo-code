import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { taskActions } from "../session-tasks"

// This child keeps Request/fetch/AbortController in one native realm under the App's HappyDOM test preload.
const received = Promise.withResolvers<void>()
const calls: string[] = []
const server = createServer((request) => {
  calls.push(`${request.method} ${request.url}`)
  received.resolve()
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("Missing fixture address")
const owner = new AbortController()
try {
  const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, throwOnError: true })
  const pending = taskActions(client, "parent", Promise.resolve("v2"))
    .changeSchedule({ source: "native-schedule", id: "intent" }, "resume", owner.signal)
    .catch((error: unknown) => error)
  await received.promise
  const reason = new Error("Session owner disposed")
  owner.abort(reason)
  assert.equal(await pending, reason)
  assert.deepEqual(calls, ["POST /api/session/parent/schedule/intent/resume"])
  console.log("Native schedule owner cancellation verified")
} finally {
  owner.abort()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
