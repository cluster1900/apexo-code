import { Computer as ComputerSchema } from "@apexo/schema/computer"
import { Computer } from "@apexo/core/computer"
import { AbsolutePath } from "@apexo/core/schema"
import { LocationServiceMap } from "@apexo/core/location-services"
import { Location } from "@apexo/core/location"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
  action: ComputerSchema.Action,
  computerSessionID: Schema.optional(ComputerSchema.ComputerSessionID),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  text: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  expectedSnapshotHash: Schema.optional(Schema.String),
  destructive: Schema.optional(Schema.Boolean),
})

const description = `Control the user's macOS desktop through the guarded Computer Use adapter. Use this tool for desktop app or window tasks, such as clicking an application's close button. Open or observe first, use coordinates from the current snapshot, and pass expectedSnapshotHash when acting. Destructive actions require approval.`

export const ComputerTool = Tool.define<typeof Parameters, { code?: string }, LocationServiceMap.Service>(
  "computer",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service

    return {
      description,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<{ code?: string }>) =>
        Effect.gen(function* () {
          const resource = params.target ?? params.computerSessionID ?? "desktop"
          if (params.action !== "observe" && params.action !== "screenshot" && params.action !== "open")
            yield* ctx.ask({
              permission: "computer_destructive",
              patterns: [resource],
              always: ["*"],
              metadata: params,
            })

          const directory = yield* InstanceState.directory
          const computer = yield* Computer.Service.pipe(
            Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
          )

          if (params.action === "open") {
            const info = yield* computer.open({ sessionID: ctx.sessionID })
            return { title: "Computer Use opened", output: JSON.stringify(info), metadata: {} }
          }

          if (!params.computerSessionID)
            return {
              title: "Computer Use needs a session",
              output: `computer.${params.action} requires computerSessionID; call computer.open first`,
              metadata: {},
            }

          const result = yield* computer.act({ ...params, computerSessionID: params.computerSessionID })
          return {
            title: `Computer Use ${params.action}`,
            output: result.output,
            metadata: {},
            ...(result.artifactData && result.artifact
              ? { attachments: [{ type: "file" as const, mime: result.artifact.mime, url: `data:${result.artifact.mime};base64,${result.artifactData}` }] }
              : {}),
          }
        }).pipe(
          Effect.catchTag("Computer.Error", (error) =>
            Effect.succeed({ title: "Computer Use unavailable", output: `Computer Use failed: ${error.message}`, metadata: { code: error.code } }),
          ),
          Effect.orDie,
        ),
    }
  }),
)
