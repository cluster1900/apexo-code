export * as PluginStore from "./plugin-store"

import { Schema } from "effect"
import { optional } from "./schema"

export const Component = Schema.Struct({
  kind: Schema.Literals(["skills", "commands", "agents", "mcpServers", "lspServers", "hooks"]),
  name: Schema.String,
  description: optional(Schema.String),
})
export interface Component extends Schema.Schema.Type<typeof Component> {}

export const Source = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  location: Schema.String,
  official: Schema.Boolean,
  updatedAt: optional(Schema.Finite),
  error: optional(Schema.String),
}).annotate({ identifier: "PluginStoreSource" })
export interface Source extends Schema.Schema.Type<typeof Source> {}

export const Item = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  sourceID: Schema.String,
  source: Schema.String,
  category: Schema.String,
  author: optional(Schema.String),
  homepage: optional(Schema.String),
  version: optional(Schema.String),
  revision: optional(Schema.String),
  installedVersion: optional(Schema.String),
  installedRevision: optional(Schema.String),
  recommended: Schema.Boolean,
  status: Schema.Literals(["available", "downloaded", "enabled", "disabled"]),
  components: Schema.Array(Component),
  warnings: Schema.Array(Schema.String),
  path: optional(Schema.String),
}).annotate({ identifier: "PluginStoreItem" })
export interface Item extends Schema.Schema.Type<typeof Item> {}

export const Catalog = Schema.Struct({
  sources: Schema.Array(Source),
  items: Schema.Array(Item),
  retainedData: optional(
    Schema.Array(Schema.Struct({ id: Schema.String, reason: Schema.Literals(["readers", "ownership"]) })),
  ),
}).annotate({
  identifier: "PluginStoreCatalog",
})
export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}

export interface Detail extends Schema.Schema.Type<typeof Detail> {}
export const Detail = Schema.Struct({ item: Item, readme: Schema.String }).annotate({ identifier: "PluginStoreDetail" })

export const Action = Schema.Struct({
  action: Schema.Literals([
    "refresh",
    "add-source",
    "remove-source",
    "install",
    "download",
    "update",
    "enable",
    "disable",
    "uninstall",
  ]),
  id: optional(Schema.String),
  source: optional(Schema.String),
  trust: optional(Schema.Boolean),
  keepData: optional(Schema.Boolean),
}).annotate({ identifier: "PluginStoreAction" })
export interface Action extends Schema.Schema.Type<typeof Action> {}

export const RuntimeFailure = Schema.Struct({
  code: Schema.Literals(["busy", "invalid", "load", "unsupported"]),
  message: Schema.String,
  components: optional(Schema.Array(Schema.Literals(["mcp", "lsp"]))),
}).annotate({ identifier: "PluginStoreRuntimeFailure" })
export interface RuntimeFailure extends Schema.Schema.Type<typeof RuntimeFailure> {}

export const Runtime = Schema.Struct({
  generation: Schema.Finite,
  active: Schema.Array(Schema.String),
  failure: optional(RuntimeFailure),
}).annotate({ identifier: "PluginStoreRuntime" })
export interface Runtime extends Schema.Schema.Type<typeof Runtime> {}
