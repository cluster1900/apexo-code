export * as ConfigLSP from "./lsp"

import { Schema } from "effect"

export const Disabled = Schema.Struct({
  disabled: Schema.Literal(true),
})

export class Server extends Schema.Class<Server>("ConfigV2.LSP.Server")({
  command: Schema.String.pipe(Schema.Array),
  transport: Schema.optional(Schema.Literals(["stdio", "socket"])),
  extensions: Schema.String.pipe(Schema.Array, Schema.optional),
  languageIds: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  env: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  initialization: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  settings: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  workspaceFolder: Schema.optional(Schema.String.check(Schema.isPattern(/\S/), Schema.isPattern(/^[^\0]*$/))),
  workspaceOpen: Schema.optional(
    Schema.Struct({
      solution: Schema.optional(Schema.String.check(Schema.isPattern(/\S/), Schema.isPattern(/^[^\0]*$/))),
      projects: Schema.optional(
        Schema.Array(Schema.String.check(Schema.isPattern(/\S/), Schema.isPattern(/^[^\0]*$/))),
      ),
    }),
  ),
  restartOnCrash: Schema.optional(Schema.Boolean),
  maxRestarts: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(4_294_967_295)),
  ),
  timeout: Schema.Struct({
    startup: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2_147_483_647)),
    ),
    shutdown: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2_147_478_647)),
    ),
    request: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  }).pipe(Schema.optional),
}) {}

export const Entry = Schema.Union([Disabled, Server])
export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
