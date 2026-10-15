export * as MemoryMode from "./memory-mode"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  enabled: Schema.Boolean,
  busy: Schema.Boolean,
  canToggle: Schema.Boolean,
  source: Schema.Literals(["process", "profile", "session", "config", "environment", "default"]),
}).annotate({ identifier: "MemoryMode.Info" })

export interface Update extends Schema.Schema.Type<typeof Update> {}
export const Update = Schema.Struct({ enabled: Schema.Boolean }).annotate({ identifier: "MemoryMode.Update" })
