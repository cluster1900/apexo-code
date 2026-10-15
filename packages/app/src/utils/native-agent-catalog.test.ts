import { expect, test } from "bun:test"
import { Agent } from "@apexo/schema/agent"
import { normalizeAgentList } from "@/context/global-sync/utils"

test("native agent request body normalizes into selectable agent settings", () => {
  const agent = Agent.Info.empty("build" as Agent.ID)
  const result = normalizeAgentList([
    { ...agent, permissions: [...agent.permissions], request: { headers: {}, body: { temperature: 0.2, topP: 0.9 } } },
  ])
  expect(result[0].name).toBe("build")
  expect(result[0].temperature).toBe(0.2)
  expect(result[0].topP).toBe(0.9)
  expect(result[0].options).toEqual({ temperature: 0.2, topP: 0.9 })
})

test("current native model API and request fields retain settings and variants", async () => {
  const { normalizeProviderList } = await import("@/context/global-sync/utils")
  const result = normalizeProviderList(
    [
      {
        id: "fixture",
        name: "Fixture",
        api: { type: "native", settings: {} },
        request: { headers: {}, body: { providerOption: true } },
      },
    ],
    [
      {
        id: "selected",
        providerID: "fixture",
        name: "Selected",
        api: { id: "wire-model", type: "aisdk", package: "fixture-sdk", url: "http://localhost", settings: {} },
        request: { headers: { "x-fixture": "yes" }, body: { temperature: 0.4 } },
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [{ id: "high", headers: {}, body: { effort: "high" } }],
        time: { released: 0 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 10000, output: 1000 },
      },
    ],
  )
  const provider = result.all.get("fixture")!
  expect(provider.options).toEqual({ providerOption: true })
  expect(provider.models.selected.api).toEqual({ id: "wire-model", url: "http://localhost", npm: "fixture-sdk" })
  expect(provider.models.selected.options).toEqual({ temperature: 0.4 })
  expect(provider.models.selected.headers).toEqual({ "x-fixture": "yes" })
  expect(provider.models.selected.variants).toEqual({ high: { effort: "high" } })
})
