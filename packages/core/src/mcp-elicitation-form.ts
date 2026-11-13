export * as McpElicitationForm from "./mcp-elicitation-form"

import { McpElicitation } from "@apexo/schema/mcp-elicitation"
import { Schema } from "effect"

export class Invalid extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}
const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))
const decode = Schema.decodeUnknownSync(McpElicitation.Form, { onExcessProperty: "error" })
const maximumBytes = 64 * 1024

/** Normalize only the documented flat MCP form subset; never strip unsupported constraints. */
export function parse(input: unknown): McpElicitation.Form {
  bounded(input)
  const schema = record(input)
  keys(schema, ["type", "properties", "required", "title", "description", "$schema", "additionalProperties"])
  for (const key of ["title", "description", "$schema"])
    if (schema[key] !== undefined && typeof schema[key] !== "string") throw new Invalid(`Expected text for ${key}`)
  if (schema.type !== "object" || (schema.additionalProperties !== undefined && schema.additionalProperties !== false))
    throw new Invalid("Expected a flat MCP object schema")
  const properties = record(schema.properties)
  if (Object.keys(properties).length > 32) throw new Invalid("MCP form exceeds 32 fields")
  const required =
    schema.required === undefined ? [] : Schema.decodeUnknownSync(Schema.Array(Schema.String))(schema.required)
  if (new Set(required).size !== required.length) throw new Invalid("Duplicate required fields")
  if (required.some((name) => !Object.hasOwn(properties, name))) throw new Invalid("Required field is not defined")
  const form = decode({
    fields: Object.entries(properties).map(([name, value]) => {
      if (["__proto__", "constructor", "prototype"].includes(name)) throw new Invalid("Reserved field name", name)
      const field = record(value)
      const base = {
        name,
        title: field.title ?? name,
        ...(field.description === undefined ? {} : { description: field.description }),
        required: required.includes(name),
        ...(field.default === undefined ? {} : { default: field.default }),
      }
      if (field.type === "boolean") {
        keys(field, ["type", "title", "description", "default"])
        return { ...base, type: "boolean" }
      }
      if (field.type === "number" || field.type === "integer") {
        keys(field, ["type", "title", "description", "default", "minimum", "maximum"])
        if (typeof field.minimum === "number" && typeof field.maximum === "number" && field.minimum > field.maximum)
          throw new Invalid("Minimum exceeds maximum", name)
        return {
          ...base,
          type: field.type,
          ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
          ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
        }
      }
      if (field.type === "string" && field.enum === undefined && field.oneOf === undefined) {
        keys(field, ["type", "title", "description", "default", "minLength", "maxLength", "format"])
        if (
          typeof field.minLength === "number" &&
          typeof field.maxLength === "number" &&
          field.minLength > field.maxLength
        )
          throw new Invalid("Minimum length exceeds maximum length", name)
        return {
          ...base,
          type: "string",
          ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
          ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
          ...(field.format === undefined ? {} : { format: field.format }),
        }
      }
      if (field.type === "string") {
        keys(field, ["type", "title", "description", "default", "enum", "enumNames", "oneOf"])
        if (field.enum !== undefined && field.oneOf !== undefined)
          throw new Invalid("Conflicting enum definitions", name)
        if (field.enumNames !== undefined && field.oneOf !== undefined)
          throw new Invalid("Conflicting enum titles", name)
        return { ...base, type: "select", options: choices(field) }
      }
      if (field.type === "array") {
        keys(field, ["type", "title", "description", "default", "items", "minItems", "maxItems"])
        const items = record(field.items)
        keys(items, ["type", "enum", "anyOf"])
        if ((items.anyOf === undefined && items.type !== "string") || (items.type !== undefined && items.type !== "string"))
          throw new Invalid("Only string enum arrays are supported", name)
        if (items.enum !== undefined && items.anyOf !== undefined)
          throw new Invalid("Conflicting enum definitions", name)
        if (typeof field.minItems === "number" && typeof field.maxItems === "number" && field.minItems > field.maxItems)
          throw new Invalid("Minimum items exceeds maximum items", name)
        return {
          ...base,
          type: "multi",
          options: choices(items),
          ...(field.minItems === undefined ? {} : { minItems: field.minItems }),
          ...(field.maxItems === undefined ? {} : { maxItems: field.maxItems }),
        }
      }
      throw new Invalid("Unsupported MCP form field type", name)
    }),
  })
  form.fields.forEach((field) => {
    if (field.default !== undefined) validateValue(field, field.default)
  })
  return form
}

export function validate(form: McpElicitation.Form, input: unknown): McpElicitation.Reply {
  const reply = decodeReply(input)
  if (reply.action !== "accept") return reply
  Object.keys(reply.content).forEach((name) => {
    if (!form.fields.some((field) => field.name === name)) throw new Invalid("Unknown form field", name)
  })
  form.fields.forEach((field) => {
    if (!Object.hasOwn(reply.content, field.name)) {
      if (field.required) throw new Invalid("This field is required", field.name)
      return
    }
    validateValue(field, reply.content[field.name])
  })
  return reply
}

export function decodeReply(input: unknown) {
  bounded(input)
  return Schema.decodeUnknownSync(McpElicitation.Reply, { onExcessProperty: "error" })(input)
}

function bounded(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > maximumBytes)
    throw new Invalid("MCP form payload exceeds 64 KiB")
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  const invalid = Object.keys(value).find((key) => !allowed.includes(key))
  if (invalid !== undefined) throw new Invalid(`Unsupported form schema key: ${invalid}`)
}
function choices(field: Record<string, unknown>) {
  if (field.oneOf !== undefined || field.anyOf !== undefined) {
    const entries = Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ const: Schema.String, title: Schema.String })),
      { onExcessProperty: "error" },
    )(field.oneOf ?? field.anyOf)
    if (new Set(entries.map((entry) => entry.const)).size !== entries.length) throw new Invalid("Duplicate enum values")
    return entries.map((entry) => ({ value: entry.const, title: entry.title }))
  }
  const entries = Schema.decodeUnknownSync(Schema.Array(Schema.String))(field.enum)
  const titles =
    field.enumNames === undefined ? entries : Schema.decodeUnknownSync(Schema.Array(Schema.String))(field.enumNames)
  if (new Set(entries).size !== entries.length || titles.length !== entries.length)
    throw new Invalid("Invalid enum values or titles")
  return entries.map((value, index) => ({ value, title: titles[index] }))
}
function validateValue(field: McpElicitation.Field, value: unknown) {
  const invalid = () => {
    throw new Invalid("Value does not match this field's constraints", field.name)
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") invalid()
    return
  }
  if (field.type === "number" || field.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (field.type === "integer" && !Number.isInteger(value)) ||
      (field.minimum !== undefined && value < field.minimum) ||
      (field.maximum !== undefined && value > field.maximum)
    )
      invalid()
    return
  }
  if (field.type === "multi") {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || !field.options.some((option) => option.value === item)) ||
      new Set(value).size !== value.length ||
      (field.minItems !== undefined && value.length < field.minItems) ||
      (field.maxItems !== undefined && value.length > field.maxItems)
    )
      invalid()
    return
  }
  if (typeof value !== "string") return invalid()
  if (field.type === "select") {
    if (!field.options.some((option) => option.value === value)) invalid()
    return
  }
  if (field.type !== "string") return invalid()
  if (
    (field.minLength !== undefined && [...value].length < field.minLength) ||
    (field.maxLength !== undefined && [...value].length > field.maxLength)
  )
    invalid()
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid()
  if (field.format === "uri" && !URL.canParse(value)) invalid()
  if ((field.format === "date" || field.format === "date-time") && !validDate(value.slice(0, 10))) invalid()
  if (field.format === "date" && value.length !== 10) invalid()
  if (
    field.format === "date-time" &&
    (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value) ||
      !Number.isFinite(Date.parse(value)))
  )
    invalid()
}
function validDate(value: string) {
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
