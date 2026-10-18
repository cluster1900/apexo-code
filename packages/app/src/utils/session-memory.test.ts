import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { nativeFetch } from "./fixtures/native-fetch"
import { memoryActions, MemoryActionError } from "./session-memory"

for (const native of [true, false]) {
  test(`Memory adapter uses selected ${native ? "native" : "compatibility"} transport without probing or waking`, async () => {
    const requests: { path: string; query: URLSearchParams; method: string; body: unknown }[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push({
        path: new URL(request.url!, "http://localhost").pathname,
        query: new URL(request.url!, "http://localhost").searchParams,
        method: request.method!,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
      })
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ enabled: true }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, fetch: nativeFetch })
      const actions = memoryActions(client, "parent", Promise.resolve(native ? "v2" : "v1"))
      const signal = AbortSignal.timeout(5000)
      await actions.status(signal)
      await actions.toggle(true, signal)
      await actions.list("a b", signal)
      await actions.get("/authorized/note.md", signal)
      await actions.forget({ path: "/authorized/note.md", hash: "reviewed-hash" }, signal)
      const prefix = `${native ? "/api" : "/experimental"}/session/parent/memory`
      expect(requests.map((item) => `${item.method} ${item.path}`)).toEqual(
        native
          ? [`GET ${prefix}`, `PATCH ${prefix}`, `GET ${prefix}/notes`, `GET ${prefix}/note`, `DELETE ${prefix}/note`]
          : [
              `GET ${prefix}/status`,
              `POST ${prefix}/toggle`,
              `GET ${prefix}`,
              `GET ${prefix}/note`,
              `POST ${prefix}/forget`,
            ],
      )
      expect(requests[2].query.get(native ? "query" : "search")).toBe("a b")
      expect(requests[3].query.get("path")).toBe("/authorized/note.md")
      expect(requests[1].body).toEqual({ enabled: true })
      expect(requests[4].body).toEqual({ path: "/authorized/note.md", hash: "reviewed-hash" })
      expect(requests).toHaveLength(5)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

for (const [status, code] of [
  [403, "forbidden"],
  [409, "restricted"],
  [404, "missing"],
  [503, "unavailable"],
] as const) {
  test(`Native Memory ${status} preserves safe failure and never falls back`, async () => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.url!)
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify({ message: "private path and policy cause" }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture address")
    try {
      const client = createApexoClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        fetch: nativeFetch,
        throwOnError: true,
      })
      const actions = memoryActions(client, "managed", Promise.resolve("v2"))
      const error = await actions.status(AbortSignal.timeout(5000)).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(MemoryActionError)
      if (!(error instanceof MemoryActionError)) throw new Error("Expected safe Memory error")
      expect(error.code).toBe(code)
      expect(error.message).not.toContain("private path")
      expect(requests).toEqual(["/api/session/managed/memory"])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}
