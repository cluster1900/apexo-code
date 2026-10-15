export * as Lsp from "./lsp"

import { Schema } from "effect"

export const Operation = Schema.Literals([
  "goToDefinition",
  "findReferences",
  "hover",
  "goToImplementation",
  "documentSymbol",
  "workspaceSymbol",
])
export type Operation = typeof Operation.Type
export const Status = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["pending", "connected", "disabled", "failed"]),
  operations: Schema.Array(Operation),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "NativeLspStatus" })
export type Status = typeof Status.Type
export const StatusList = Schema.Array(Status)
