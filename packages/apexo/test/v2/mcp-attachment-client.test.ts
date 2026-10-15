import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { createMcpAttachmentOperation } from "@apexo/sdk/v2/mcp-attachment"

for (const held of ["reserve", "execute", "cancel-error"] as const) {
  test(`MCP attachment client cancellation joins ${held} and suppresses late delivery`, async () => {
    const requests: { path: string; body: string }[] = []
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const joined = Promise.withResolvers<void>()
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push({ path: request.url!, body: Buffer.concat(chunks).toString() })
      const action = request.url!.endsWith("/execute")
        ? "execute"
        : request.url!.endsWith("/cancel")
          ? "cancel"
          : "reserve"
      if (action === (held === "cancel-error" ? "execute" : held)) {
        entered.resolve()
        await release.promise
      }
      if (
        action === "cancel" &&
        held === "cancel-error" &&
        requests.filter((row) => row.path.endsWith("/cancel")).length === 1
      ) {
        response
          .writeHead(503, { "content-type": "application/json" })
          .end(JSON.stringify({ message: "Temporary cancellation outage" }))
        return
      }
      if (action === "cancel") {
        await joined.promise
        release.resolve()
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: `maop_${"1".repeat(32)}`,
          kind: "catalog",
          status: action === "cancel" ? "cancelled" : action === "execute" ? "completed" : "reserved",
          expiresAt: Date.now() + 300000,
          ...(action === "execute" ? { catalog: { resources: [], templates: [], errors: [] } } : {}),
        }),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    try {
      const operation = createMcpAttachmentOperation(
        createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}` }),
        "session-one",
      )
      const result = operation.run({ kind: "catalog", input: {} })
      await entered.promise
      let cancelled = false
      if (held === "cancel-error") {
        await expect(operation.cancel()).rejects.toBeDefined()
        expect(operation.cancelled).toBe(true)
      }
      const cancellation = operation.cancel().then(() => {
        cancelled = true
      })
      if (held === "reserve") release.resolve()
      await Bun.sleep(10)
      expect(cancelled).toBe(false)
      joined.resolve()
      await cancellation
      expect(cancelled).toBe(true)
      expect(await result).toBeUndefined()
      expect(requests.filter((row) => row.path.endsWith("/cancel"))).toHaveLength(held === "cancel-error" ? 2 : 1)
      expect(requests.find((row) => row.path.endsWith("/cancel"))?.body).toBe("")
      expect(requests.filter((row) => row.path.endsWith("/execute"))).toHaveLength(held === "reserve" ? 0 : 1)
      await operation.cancel()
      expect(requests.filter((row) => row.path.endsWith("/cancel"))).toHaveLength(held === "cancel-error" ? 2 : 1)
    } finally {
      release.resolve()
      joined.resolve()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
