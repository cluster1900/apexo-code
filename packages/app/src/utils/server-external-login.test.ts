import { describe, expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi } from "./server-compat"

describe("native login compatibility", () => {
  for (const protocol of ["v1", "v2"] as const) {
    for (const connected of [false, true]) {
      test(`${protocol} routes external login (${connected}) without submitting a credential`, async () => {
        const requests: { url: URL; body: unknown; auth: string | null; directory: string | null }[] = []
        const server = { url: "http://localhost:4096", username: "apexo", password: "fixture" }
        const fetch = (async (request: Request) => {
          const url = new URL(request.url)
          requests.push({
            url,
            body: request.body ? await request.json() : undefined,
            auth: request.headers.get("authorization"),
            directory: request.headers.get("x-apexo-directory"),
          })
          if (url.pathname === "/instance/dispose") return Response.json(true)
          return Response.json(protocol === "v1" ? connected : { location: {}, data: connected })
        }) as typeof globalThis.fetch
        const api = createCompatibleApi({
          protocol: Promise.resolve(protocol),
          directory: "/tmp/project with spaces",
          current: createApiForServer({ server, fetch }),
          legacy: (directory) => createSdkForServer({ server, directory, fetch, throwOnError: true }),
        })
        expect(
          await api.integration.connect.external({
            integrationID: "antigravity",
            methodID: protocol === "v1" ? "0" : "agy",
          }),
        ).toEqual({ data: connected })
        expect(requests[0].url.pathname).toBe(
          protocol === "v1" ? "/provider/antigravity/external" : "/api/integration/antigravity/connect/external",
        )
        expect(requests[0].body).toEqual(protocol === "v1" ? { method: 0 } : { methodID: "agy" })
        expect(requests[0].auth).toBe(`Basic ${btoa("apexo:fixture")}`)
        expect(
          protocol === "v1"
            ? decodeURIComponent(requests[0].directory ?? "")
            : requests[0].url.searchParams.get("location[directory]"),
        ).toBe("/tmp/project with spaces")
        expect(requests.filter((request) => request.url.pathname === "/instance/dispose")).toHaveLength(
          protocol === "v1" && connected ? 2 : 0,
        )
      })
    }
  }
})
