import type { ModelDefaultOutput } from "@apexo/client/promise"
import { expect, test } from "bun:test"
import { optionalModelDefault } from "./optional-model-default"
import { createApiForServer } from "./server"

for (const status of [200, 404, 503]) {
  test(`optional native default handles HTTP ${status} without hiding other failures`, async () => {
    const expected: ModelDefaultOutput = {
      data: {
        providerID: "fixture",
        id: "selected",
        modelID: "selected",
        name: "Selected",
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 10000, output: 1000 },
      },
      location: { directory: "/fixture", project: { id: "fixture", directory: "/fixture" } },
    }
    const api = createApiForServer({
      server: { url: "http://localhost:4096" },
      fetch: (async (_request: Request) =>
        Response.json(status === 200 ? expected : { error: "unavailable" }, { status })) as typeof globalThis.fetch,
    })
    const result = optionalModelDefault(api.model.default({ location: { directory: "/fixture" } }))
    if (status === 503) {
      await expect(result).rejects.toEqual({ error: "unavailable" })
      return
    }
    expect(await result).toEqual(status === 200 ? expected : undefined)
  })
}
