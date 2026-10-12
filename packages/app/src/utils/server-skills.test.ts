import { describe, expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi } from "./server-compat"

describe("skill reload compatibility", () => {
  for (const protocol of ["v1", "v2"] as const) {
    test(`${protocol} reload uses the selected directory and server credentials`, async () => {
      const requests: Request[] = []
      const server = { url: "http://localhost:4096", username: "apexo", password: "test-password" }
      const fetch = (async (request: Request) => {
        requests.push(request)
        return protocol === "v2" ? new Response(null, { status: 204 }) : Response.json(true)
      }) as typeof globalThis.fetch
      const api = createCompatibleApi({
        protocol: Promise.resolve(protocol),
        directory: "/tmp/project with spaces",
        current: createApiForServer({ server, fetch }),
        legacy: (directory) => createSdkForServer({ server, fetch, directory, throwOnError: true }),
      })

      await api.skill.reload()

      expect(requests).toHaveLength(1)
      const url = new URL(requests[0].url)
      expect(url.pathname).toBe(protocol === "v2" ? "/api/skill/reload" : "/skill/reload")
      expect(url.searchParams.get(protocol === "v2" ? "location[directory]" : "directory")).toBe(
        "/tmp/project with spaces",
      )
      expect(requests[0].method).toBe("POST")
      expect(requests[0].body).toBeNull()
      expect(requests[0].headers.get("authorization")).toBe(`Basic ${btoa("apexo:test-password")}`)
    })
  }
})
