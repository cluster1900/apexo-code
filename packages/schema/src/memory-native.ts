export * as NativeMemory from "./memory-native"

import { Schema } from "effect"
import { MemoryMode } from "./memory-mode"
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ...MemoryMode.Info.fields,
  backend: Schema.Literals(["legacy", "v2"]),
}).annotate({ identifier: "NativeMemory.Info" })
