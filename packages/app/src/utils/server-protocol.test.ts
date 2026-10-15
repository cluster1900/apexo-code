import { expect, test } from "bun:test"
import { fetch } from "bun"
import { createServer } from "node:http"
import { detectServerProtocol } from "./server-protocol"

for (const mode of ["legacy", "native", "historical-native"] as const) {
  test(`detects ${mode} health without confusing shared healthy payloads`, async () => {
    const paths: string[] = []
    const server = createServer((request, response) => {
      paths.push(request.url!)
      if (request.headers.authorization !== `Basic ${btoa("apexo:test-password")}`) {
        response.writeHead(401).end()
        return
      }
      if (request.url === "/global/health" && mode !== "legacy") {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(mode === "historical-native" ? { pid: 123 } : { healthy: true }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      expect(
        await detectServerProtocol(
          { url: `http://127.0.0.1:${address.port}`, username: "apexo", password: "test-password" },
          fetch,
        ),
      ).toBe(mode === "legacy" ? "v1" : "v2")
      expect(paths).toEqual(mode === "legacy" ? ["/global/health"] : ["/global/health", "/api/health"])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
