import { expect, test } from "bun:test"
import { createApexoClient } from "../src/v2/client"
import { codeReviewAvailable } from "../src/v2/code-review"

test("review capability probes the actual endpoint independently of legacy health", async () => {
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(request.method)
      const pathname = new URL(request.url).pathname
      if (pathname === "/global/health") return Response.json({ healthy: true })
      if (pathname.includes("ses_missing")) return new Response(null, { status: 404 })
      if (pathname.includes("ses_unsupported")) return new Response(null, { status: 405 })
      if (pathname.includes("ses_denied")) return new Response(null, { status: 403 })
      return Response.json({ data: [] })
    },
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.href })
    expect((await fetch(new URL("/global/health", server.url))).ok).toBe(true)
    expect(await codeReviewAvailable(client, "ses_native")).toBe(true)
    expect(await codeReviewAvailable(client, "ses_missing")).toBe(false)
    expect(await codeReviewAvailable(client, "ses_unsupported")).toBe(false)
    await expect(codeReviewAvailable(client, "ses_denied")).rejects.toThrow("HTTP 403")
    expect(requests).toEqual(["GET", "GET", "GET", "GET", "GET"])
  } finally {
    await server.stop(true)
  }
})
