export * as SessionMcpAttachment from "./session-mcp-attachment"

import { Schema } from "effect"

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_384))
const metadata = {
  server: Name,
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
}
export const Resource = Schema.Struct({ ...metadata, uri: Name })
export const Template = Schema.Struct({ ...metadata, uriTemplate: Name, variables: Schema.Array(Schema.String) })
export const CatalogInput = Schema.Struct({ server: Schema.optional(Name) })
export type CatalogInput = typeof CatalogInput.Type
export const Catalog = Schema.Struct({
  resources: Schema.Array(Resource),
  templates: Schema.Array(Template),
  errors: Schema.Array(Schema.Struct({ server: Schema.String, code: Schema.String, message: Schema.String })),
}).annotate({ identifier: "SessionMcpAttachment.Catalog" })
export type Catalog = typeof Catalog.Type
export const Parameters = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Record(Schema.String, Schema.String)]),
)
export const Input = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("resource"), server: Name, uri: Name }),
  Schema.Struct({ kind: Schema.Literal("template"), server: Name, uriTemplate: Name, parameters: Parameters }),
]).annotate({ identifier: "SessionMcpAttachment.Input" })
export type Input = typeof Input.Type
export const Prepared = Schema.Struct({
  server: Name,
  resourceURI: Name,
  files: Schema.Array(Schema.Struct({ uri: Schema.String, name: Schema.String, mimeType: Schema.String })),
}).annotate({ identifier: "SessionMcpAttachment.Prepared" })
export type Prepared = typeof Prepared.Type
export class Failure extends Schema.TaggedErrorClass<Failure>()("SessionMcpAttachment.Failure", {
  code: Schema.Literals([
    "missing",
    "changed",
    "denied",
    "unavailable",
    "invalid",
    "unsupported",
    "limit",
    "expired",
    "conflict",
  ]),
  message: Schema.String,
}) {}
