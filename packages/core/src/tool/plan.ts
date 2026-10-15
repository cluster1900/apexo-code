export * as PlanTools from "./plan"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SessionPlan } from "../session/plan"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

const Input = Schema.Struct({})
const Output = Schema.Struct({ path: Schema.String, message: Schema.String })
const failure = (error: unknown) =>
  new Tool.Failure({
    message:
      error instanceof SessionPlan.Failure ? error.message : "Plan transition is unavailable or permission was denied",
  })
export const node = makeLocationNode({
  name: "tool/plan",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const plans = yield* SessionPlan.Service
      yield* tools
        .register({
          plan_enter: Tool.make({
            description:
              "Enter native Plan mode to inspect an ordinary build Session and prepare its plan before implementation. Configured permissions apply. Shell requires permission; Task, Workflow and dynamic tools remain unavailable.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
            execute: (_input, context) => plans.enter(context).pipe(Effect.mapError(failure)),
          }),
          plan_exit: Tool.make({
            description:
              "Present this Session's completed plan for explicit user approval. Approval switches to build mode; rejection stays in Plan. Call only when the plan is ready.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
            execute: (_input, context) =>
              plans.ask(context).pipe(
                Effect.catchTag("SessionPlan.RejectedError", (error) => Effect.die(error)),
                Effect.mapError(failure),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
  deps: [ToolRegistry.node, SessionPlan.node],
})
