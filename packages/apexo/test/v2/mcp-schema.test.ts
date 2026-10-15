import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Mcp } from "@apexo/schema/mcp"

test("native MCP preference metadata omits undefined wire fields and preserves false", () => {
  const encode = Schema.encodeSync(Mcp.Status)
  const absent = encode({
    status: "disabled",
    tools: 0,
    configuredEnabled: undefined,
    preference: undefined,
    preferenceError: undefined,
  })
  expect(Object.hasOwn(absent, "configuredEnabled")).toBe(false)
  expect(Object.hasOwn(absent, "preference")).toBe(false)
  expect(Object.hasOwn(absent, "preferenceError")).toBe(false)
  expect(encode({ status: "disabled", tools: 0, configuredEnabled: false, preference: false })).toEqual({
    status: "disabled",
    tools: 0,
    configuredEnabled: false,
    preference: false,
  })
})
