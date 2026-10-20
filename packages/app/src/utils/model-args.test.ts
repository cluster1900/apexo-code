import { expect, test } from "bun:test"
import { resolveModelArgs } from "./model-args"

const models = [
  { id: "grok-4.6", name: "Grok 4.6", provider: { id: "xai" } },
  { id: "reasoning-x", name: "Reasoning X", provider: { id: "xai" } },
  { id: "reasoning-x", name: "Reasoning X", provider: { id: "openrouter" } },
]

test("matches a model by ID, provider/ID or display name, ignoring letter case", () => {
  expect(resolveModelArgs("grok-4.6", models)?.model.id).toBe("grok-4.6")
  expect(resolveModelArgs("Grok 4.6", models)?.model.id).toBe("grok-4.6")
  expect(resolveModelArgs("openrouter/REASONING-X", models)?.model.provider.id).toBe("openrouter")
})

test("a trailing word after the model name is the effort level", () => {
  expect(resolveModelArgs("Reasoning X high", models)).toEqual({ model: models[1], effort: "high" })
})

test("the current provider wins when several providers list the name", () => {
  expect(resolveModelArgs("reasoning x", models, "openrouter")?.model).toBe(models[2])
})

test("unknown names resolve to nothing", () => {
  expect(resolveModelArgs("nope", models)).toBeUndefined()
  expect(resolveModelArgs("nope high", models)).toBeUndefined()
  expect(resolveModelArgs("", models)).toBeUndefined()
})
