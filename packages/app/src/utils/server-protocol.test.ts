import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { nativeFetch } from "./fixtures/native-fetch"
import { detectServerProtocol } from "./server-protocol"

for (const mode of ["legacy", "native", "historical-native", "hybrid"] as const) {
  test(`detects ${mode} health without confusing shared healthy payloads`, async () => {
    const paths: string[] = []
    const server = createServer((request, response) => {
      paths.push(request.url!)
      if (request.headers.authorization !== `Basic ${btoa("apexo:test-password")}`) {
        response.writeHead(401).end()
        return
      }
      if (request.url === "/api/health" && mode === "legacy") {
        response.writeHead(404).end()
        return
      }
      if (request.url === "/global/health" && mode !== "legacy" && mode !== "hybrid") {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify(
          request.url === "/api/health" || mode === "historical-native" ? { pid: 123 } : { healthy: true },
        ),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      expect(
        await detectServerProtocol(
          { url: `http://127.0.0.1:${address.port}`, username: "apexo", password: "test-password" },
          nativeFetch,
        ),
      ).toBe(mode === "legacy" ? "v1" : "v2")
      expect(paths).toEqual(mode === "legacy" ? ["/api/health", "/global/health"] : ["/api/health"])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
