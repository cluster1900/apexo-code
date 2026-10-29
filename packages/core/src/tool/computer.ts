export * as ComputerTool from "./computer"

import { Computer as ComputerSchema } from "@apexo/schema/computer"
import { ToolFailure } from "@apexo/llm"
import { Effect, Layer, Schema } from "effect"
import { Computer } from "../computer"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "computer"

export const description = `Control the user's macOS desktop through the guarded Computer Use adapter. Use this tool when the request refers to a desktop app or window, such as clicking an application's close button. Observe or take a screenshot before acting, then use coordinates from the current observation. Destructive actions require approval and stale observations are rejected.`

export const Input = Schema.Struct({
  ...ComputerSchema.ActionInput.fields,
  computerSessionID: Schema.optional(ComputerSchema.ComputerSessionID),
})

const Output = Schema.Struct({
  computerSessionID: ComputerSchema.ComputerSessionID,
  actionID: Schema.optional(ComputerSchema.ActionID),
  action: ComputerSchema.Action,
  output: Schema.String,
  snapshot: Schema.optional(ComputerSchema.Snapshot),
  artifact: Schema.optional(ComputerSchema.Artifact),
  artifactData: Schema.optional(Schema.String),
})

const isReadOnly = (action: ComputerSchema.Action) => action === "open" || action === "observe" || action === "screenshot"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const computer = yield* Computer.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) =>
            output.artifactData
              ? [{ type: "file", data: output.artifactData, mime: output.artifact?.mime ?? "image/png", name: output.artifact?.relativePath }]
              : [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const action = input.action
              const resource = input.target ?? input.computerSessionID ?? "desktop"
              yield* permission.assert({
                action: isReadOnly(action) ? name : `${name}_destructive`,
                resources: [resource],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              if (action === "open") {
                const info = yield* computer.open({ sessionID: context.sessionID })
                return { computerSessionID: info.id, action, output: JSON.stringify(info), ...(info.snapshot ? { snapshot: info.snapshot } : {}) }
              }
              if (!input.computerSessionID)
                return yield* new ToolFailure({ message: `computer.${action} requires computerSessionID; call computer.open first` })
              const result = yield* computer.act(input as Omit<ComputerSchema.ActionInput, "computerSessionID"> & { readonly computerSessionID: ComputerSchema.ComputerSessionID })
              return {
                computerSessionID: input.computerSessionID,
                actionID: result.actionID,
                action,
                output: result.output,
                ...(result.snapshot ? { snapshot: result.snapshot } : {}),
                ...(result.artifact ? { artifact: result.artifact } : {}),
                ...(result.artifactData ? { artifactData: result.artifactData } : {}),
              }
            }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : new ToolFailure({ message: error.message })))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({ name: "tool/computer", layer, deps: [ToolRegistry.node, PermissionV2.node, Computer.node] })
