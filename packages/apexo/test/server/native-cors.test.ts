import { afterAll, describe, expect, test } from "bun:test"
import { createRoutes, webHandler } from "@apexo/server/routes"
import { Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"

const app = webHandler()
const protectedApp = HttpRouter.toWebHandler(
  createRoutes("native-cors-fixture").pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)
afterAll(async () => {
  await app.dispose()
  await protectedApp.dispose()
})

function preflight(origin: string) {
  return new Request("http://localhost/api/session/ses_cors/goal", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, authorization, x-apexo-directory",
    },
  })
}

describe("native Server CORS", () => {
  test("Desktop and local browser preflights preserve origin and header cache keys", async () => {
    for (const origin of ["oc://renderer", "http://localhost:3000"]) {
      const response = await app.handler(preflight(origin))
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe(origin)
      expect(response.headers.get("access-control-allow-methods")).toContain("POST")
      expect(response.headers.get("access-control-allow-headers")).toContain("authorization")
      const vary = response.headers
        .get("vary")!
        .toLowerCase()
        .split(",")
        .map((value) => value.trim())
      expect(vary.filter((value) => value === "origin")).toHaveLength(1)
      expect(vary).toContain("access-control-request-headers")
    }
  })

  test("native responses are readable from the Desktop renderer", async () => {
    const response = await app.handler(
      new Request("http://localhost/api/health", { headers: { origin: "oc://renderer" } }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe("oc://renderer")
    expect(await response.json()).toEqual({ healthy: true })
  })

  test("untrusted origins receive no CORS access", async () => {
    const response = await app.handler(preflight("https://untrusted.example"))
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("successful preflight does not authorize the subsequent mutation", async () => {
    const response = await protectedApp.handler(preflight("oc://renderer"))
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("oc://renderer")
    const mutation = await protectedApp.handler(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { origin: "oc://renderer", "content-type": "application/json" },
        body: "{}",
      }),
    )
    expect(mutation.status).toBe(401)
    expect(mutation.headers.get("access-control-allow-origin")).toBe("oc://renderer")
  })
})
