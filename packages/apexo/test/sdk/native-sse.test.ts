import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"

test("native SDK event subscription cancels a blocked reader without an unhandled rejection", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.write('data: {"type":"server.connected","properties":{}}\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected a TCP fixture")
  try {
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}` })
    for (const _ of [0, 1, 2]) {
      const abort = new AbortController()
      const events = await client.v2.event.subscribe({ signal: abort.signal, sseMaxRetryAttempts: 0 })
      expect((await events.stream.next()).value).toMatchObject({ type: "server.connected" })
      const reading = events.stream.next()
      abort.abort()
      expect((await reading).done).toBe(true)
    }
    // Let rejected cancellation promises reach the test runner before teardown.
    await Bun.sleep(0)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}, 10000)
