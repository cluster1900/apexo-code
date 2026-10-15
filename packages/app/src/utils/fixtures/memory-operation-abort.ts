import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { memoryOperationActions } from "../memory-operations"

// Keep Request, fetch and abort signals in the same native realm.
for (const which of ["owner", "call"] as const) {
  {
    const entered = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    const server = createServer((request, response) => {
      request.socket.once("close", () => closed.resolve())
      entered.resolve()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    try {
      const owner = new AbortController()
      const call = new AbortController()
      const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch })
      const actions = memoryOperationActions(client, async () => "session", owner.signal)
      const pending = actions.list(call.signal).then(
        () => "resolved",
        () => "rejected",
      )
      await entered.promise
      if (which === "owner") owner.abort()
      if (which === "call") call.abort()
      assert.equal(await pending, "rejected")
      await closed.promise
      assert.equal(owner.signal.aborted, which === "owner")
      assert.equal(call.signal.aborted, which === "call")
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

console.log("Native Memory owner and call cancellation verified")
