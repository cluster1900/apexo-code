import type { SessionManagedChild } from "./managed-child"
import type { SessionMessage } from "./message"
export * as SessionGoalRole from "./goal-role"

import { Context, Effect, Layer, Schema } from "effect"
import { ToolDefinition } from "@apexo/llm"
import { makeGlobalNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool/registry"
import { SessionSchema } from "./schema"
import { SessionGoal } from "./goal"
import { SessionGoalFiles } from "./goal-files"

export type Role = {
  readonly owner: SessionManagedChild.Record
  readonly inputID: SessionMessage.ID
  readonly take: () => boolean
  readonly attempt: SessionGoal.Attempt
  readonly system: string
  readonly files: Awaited<ReturnType<typeof SessionGoalFiles.create>>
  readonly advisory?: boolean
  readonly observe: (receipt: { callID: string; tokens?: number }) => void
}

/** Only live capabilities live here. Durable child ownership is recorded on the Session separately. */
export class Service extends Context.Service<
  Service,
  {
    readonly get: (id: SessionSchema.ID) => Role | undefined
    readonly attach: (
      id: SessionSchema.ID,
      role: Omit<Role, "take">,
    ) => Effect.Effect<void, never, import("effect").Scope.Scope>
  }
>()("@apexo/v2/SessionGoalRole") {}

export const node = makeGlobalNode({
  service: Service,
  layer: Layer.sync(Service, () => {
    const roles = new Map<SessionSchema.ID, Role>()
    return Service.of({
      get: (id) => roles.get(id),
      attach: (id, input) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            if (roles.has(id)) throw new Error("Goal review Session already has an owner")
            const state = { consumed: false }
            const role = {
              ...input,
              take: () => {
                if (state.consumed) return false
                state.consumed = true
                return true
              },
            }
            roles.set(id, role)
            return role
          }),
          (role) =>
            Effect.sync(() => {
              if (roles.get(id) === role) roles.delete(id)
            }),
        ).pipe(Effect.asVoid),
    })
  }),
  deps: [],
})

const allowed = new Set(["read", "glob", "grep", "list", "lsp", "bash", "webfetch", "websearch"])
const Write = Schema.Struct({ path: Schema.String, content: Schema.String })

/** Report writes are local to this materialization, never registered in a Location-wide registry. */
export function materialize(
  role: Role,
  base: ToolRegistry.Materialization,
  goals: SessionGoal.Interface,
  permission: PermissionV2.Interface,
): ToolRegistry.Materialization {
  const definitions = base.definitions.filter(
    (tool) => allowed.has(tool.name) && (!role.advisory || tool.name !== "bash"),
  )
  return {
    definitions: [
      ...definitions,
      ToolDefinition.make({
        name: "goal_report_write",
        description: "Write one assigned Goal report file. Other paths are forbidden.",
        inputSchema: Schema.toJsonSchemaDocument(Write).schema,
      }),
    ],
    settle: (input) =>
      Effect.gen(function* () {
        yield* goals.check(role.attempt).pipe(Effect.orDie)
        if (input.call.name !== "goal_report_write") {
          if (!definitions.some((tool) => tool.name === input.call.name))
            return {
              result: {
                type: "error" as const,
                value: "Tool is unavailable to this Goal role",
              },
            }
          return yield* base.settle(input)
        }
        return yield* Effect.gen(function* () {
          const value = yield* Schema.decodeUnknownEffect(Write)(input.call.input)
          if (!role.files.allowed.includes(value.path))
            return {
              result: {
                type: "error" as const,
                value: "Unassigned report path",
              },
            }
          yield* permission.assert({
            action: "edit",
            resources: [value.path],
            save: [value.path],
            sessionID: input.sessionID,
            agent: input.agent,
            source: {
              type: "tool",
              messageID: input.assistantMessageID,
              callID: input.call.id,
            },
          })
          yield* goals.check(role.attempt)
          yield* Effect.tryPromise(() => role.files.write(value.path, value.content))
          yield* goals.check(role.attempt)
          return { result: { type: "text" as const, value: "Report written" } }
        }).pipe(
          Effect.catch(() =>
            Effect.succeed({
              result: {
                type: "error" as const,
                value: "Unable to write Goal report",
              },
            }),
          ),
        )
      }),
  }
}
