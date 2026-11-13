import { expect, test } from "bun:test"
import { Schema } from "effect"
import { McpElicitation } from "@apexo/schema/mcp-elicitation"
import { McpElicitationForm } from "@apexo/core/mcp-elicitation-form"

const schema = {
  type: "object",
  properties: {
    environment: {
      type: "string",
      oneOf: [
        { const: "dev", title: "Development" },
        { const: "prod", title: "Production" },
      ],
      default: "dev",
    },
    quantity: { type: "integer", minimum: 1, maximum: 5, default: 2 },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    confirm: { type: "boolean", default: false },
    tags: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        anyOf: [
          { const: "a", title: "A" },
          { const: "b", title: "B" },
        ],
      },
      default: ["a"],
    },
    note: { type: "string", minLength: 1, maxLength: 4 },
  },
  required: ["environment", "quantity", "confirm", "tags"],
}
const content = { environment: "dev", quantity: 2, ratio: 0.5, confirm: false, tags: ["a"], note: "😀" }

test("MCP forms preserve flat field types, titled choices and visual defaults", () => {
  const form = McpElicitationForm.parse(schema)
  expect(form.fields[0]).toMatchObject({
    type: "select",
    default: "dev",
    options: [
      { value: "dev", title: "Development" },
      { value: "prod", title: "Production" },
    ],
  })
  expect(form.fields.find((field) => field.name === "tags")).toMatchObject({ type: "multi", default: ["a"] })
  expect(McpElicitationForm.validate(form, { action: "accept", content })).toEqual({ action: "accept", content })
  expect(McpElicitationForm.validate(form, { action: "decline" })).toEqual({ action: "decline" })
  expect(McpElicitationForm.validate(form, { action: "cancel" })).toEqual({ action: "cancel" })
  expect(() => McpElicitationForm.validate(form, { action: "accept", content: {} })).toThrow("required")
})

test("MCP reply validation rejects coercion, bounds, unknown keys and nested values", () => {
  const form = McpElicitationForm.parse(schema)
  for (const invalid of [
    { quantity: "2" },
    { quantity: 1.5 },
    { quantity: 0 },
    { quantity: 6 },
    { ratio: NaN },
    { confirm: "false" },
    { tags: [] },
    { tags: ["a", "a"] },
    { tags: ["other"] },
    { environment: "other" },
    { note: "too long" },
    { note: { nested: true } },
    { unknown: true },
  ])
    expect(() => McpElicitationForm.validate(form, { action: "accept", content: { ...content, ...invalid } })).toThrow()
  expect(() => McpElicitationForm.validate(form, { action: "decline", content })).toThrow()
})

test("MCP schemas reject unsupported constraints, invalid defaults and size limits", () => {
  for (const field of [
    { type: "object", properties: {} },
    { type: "string", "": true },
    { type: "array", items: { type: "string" } },
    { type: "string", $ref: "#/other" },
    { type: "string", pattern: ".*" },
    { type: "integer", default: 1.5 },
    { type: "boolean", default: "false" },
    { type: "string", minLength: 3, maxLength: 1 },
    { type: "number", minimum: 3, maximum: 1 },
    { type: "string", enum: ["a", "a"] },
    { type: "string", enum: Array.from({ length: 101 }, (_, i) => String(i)) },
  ])
    expect(() => McpElicitationForm.parse({ type: "object", properties: { field } })).toThrow()
  expect(() => McpElicitationForm.parse({ ...schema, required: ["constructor"] })).toThrow()
  expect(() =>
    McpElicitationForm.parse({
      ...schema,
      properties: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, { type: "string" }])),
    }),
  ).toThrow()
  expect(() => McpElicitationForm.parse({ ...schema, description: "x".repeat(65536) })).toThrow("64 KiB")
})

test("MCP formats and new request IDs retain their exact contract", () => {
  for (const [format, valid, invalid] of [
    ["email", "a@example.test", "missing-at"],
    ["uri", "https://example.test", "/relative"],
    ["date", "2024-02-29", "2025-02-29"],
    ["date-time", "2024-02-29T12:00:00Z", "2024-02-29T12:00:00"],
  ]) {
    const form = McpElicitationForm.parse({ type: "object", properties: { value: { type: "string", format } } })
    expect(McpElicitationForm.validate(form, { action: "accept", content: { value: valid } })).toMatchObject({
      content: { value: valid },
    })
    expect(() => McpElicitationForm.validate(form, { action: "accept", content: { value: invalid } })).toThrow()
  }
  const time = McpElicitationForm.parse({
    type: "object",
    properties: { value: { type: "string", format: "date-time" } },
  })
  expect(() =>
    McpElicitationForm.validate(time, { action: "accept", content: { value: "2024-02-29T24:00:00Z" } }),
  ).toThrow()
  expect(Schema.decodeUnknownSync(McpElicitation.ID)(McpElicitation.ID.create())).toMatch(/^elc_/)
  expect(() => Schema.decodeUnknownSync(McpElicitation.ID)("elc-missing-underscore")).toThrow()
})
