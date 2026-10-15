import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { CommandPromptError, loopPrompt } from "@apexo/sdk/v2/command-prompt"

test("native loop discovery expands once, retains literal arguments and never posts", async () => {
  const calls: string[] = []
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`)
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ data: [{ name: "loop", template: "Usage when empty. Request:\n$ARGUMENTS\nEnd." }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing listener")
  try {
    const client = createApexoClient({ baseUrl: `http://127.0.0.1:${address.port}`, throwOnError: true })
    expect(await loopPrompt(client, { arguments: "5m $& $ARGUMENTS\nsecond line", directory: "/work" })).toBe(
      "Usage when empty. Request:\n5m $& $ARGUMENTS\nsecond line\nEnd.",
    )
    expect(await loopPrompt(client, { arguments: "", directory: "/work" })).toBe("Usage when empty. Request:\n\nEnd.")
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.startsWith("GET /api/command?")).toBe(true)
      const url = new URL(call.slice(4), "http://localhost")
      expect(url.searchParams.get("location[directory]")).toBe("/work")
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

for (const metadata of [{ agent: "other" }, { model: { id: "model", providerID: "provider" } }, { subtask: true }]) {
  test(`native loop rejects execution metadata ${Object.keys(metadata)[0]}`, async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ data: [{ name: "loop", template: "$ARGUMENTS", ...metadata }] }),
    })
    try {
      const client = createApexoClient({ baseUrl: server.url.toString(), throwOnError: true })
      await expect(loopPrompt(client, { arguments: "5m check" })).rejects.toMatchObject({ code: "unsupported" })
    } finally {
      await server.stop(true)
    }
  })
}

test("native loop sanitizes failed discovery despite throwOnError client default", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ cause: "PRIVATE_CAUSE" }, { status: 503 }),
  })
  try {
    const client = createApexoClient({ baseUrl: server.url.toString(), throwOnError: true })
    const error = await loopPrompt(client, { arguments: "" }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(CommandPromptError)
    expect(error).toMatchObject({ code: "unavailable" })
    expect(String(error)).not.toContain("PRIVATE_CAUSE")
  } finally {
    await server.stop(true)
  }
})
