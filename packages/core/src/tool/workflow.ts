export * as WorkflowTool from "./workflow"

import { Effect, Layer } from "effect"
import { Workflow } from "@apexo/schema/workflow"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { WorkflowRuntime } from "../workflow/runtime"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

export const node = makeLocationNode({
  name: "tool/workflow",
  deps: [ToolRegistry.node, PermissionV2.node, WorkflowRuntime.node],
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const permission = yield* PermissionV2.Service
      const workflows = yield* WorkflowRuntime.Service
      yield* tools
        .register({
          workflow: Tool.make({
            description:
              "Run a bounded native workflow with independent child Sessions, or built-in deep-research with independent evidence verification. Workflow children cannot launch nested workflows. Definitions and args are frozen for this run.",
            input: Workflow.Start,
            output: Workflow.Info,
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* permission.assert({
                  action: "workflow",
                  resources: [input.source.type === "definition" ? input.source.definition.name : input.source.name],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const info = yield* workflows.start(context.sessionID, input)
                if (!info) return yield* new Tool.Failure({ message: "Workflow execution was interrupted" })
                return info
              }).pipe(
                Effect.mapError((error) =>
                  error instanceof Tool.Failure ? error : new Tool.Failure({ message: String(error) }),
                ),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
})
