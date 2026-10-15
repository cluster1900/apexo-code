export * as McpEvent from "./mcp-event"

import { Schema } from "effect"
import { Event } from "./event"
import { optional } from "./schema"

export const ToolsChanged = Event.define({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})

export const BrowserOpenFailed = Event.define({
  type: "mcp.browser.open.failed",
  schema: {
    mcpName: Schema.String,
    url: Schema.String,
  },
})

export const Definitions = Event.inventory(ToolsChanged, BrowserOpenFailed)

// Native runtime invalidation carries no transport details or stale status snapshot.
export const StatusChanged = Event.define({
  type: "mcp.status.changed",
  schema: { server: optional(Schema.String) },
})
export const CurrentDefinitions = Event.inventory(StatusChanged)
