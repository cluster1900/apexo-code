export * as SchedulerTools from "./scheduler"

import { Effect, Layer, Schema } from "effect"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { optional } from "@apexo/schema/schema"
import { makeLocationNode } from "../effect/app-node"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionStore } from "../session/store"
import { SessionManagedChild } from "../session/managed-child"
import { SessionGoalUsage } from "../session/goal-usage"
import { SessionTaskRole } from "../session/task-role"
import { SessionTaskStore } from "../session/task-store"
import { SessionScheduleRuntime } from "../session/schedule"
import { SessionScheduleStore } from "../session/schedule-store"
import { SessionScheduleRecord } from "../session/schedule-record"
import { SessionRunnerModel } from "../session/runner/model"
import { SessionLifecycle } from "../session/lifecycle"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

const Create = Schema.Struct({
  task_id: optional(SessionSchedule.ID),
  interval: optional(Schema.String),
  prompt: optional(SessionScheduleRecord.Request.fields.prompt),
  recurring: optional(Schema.Boolean),
  durable: optional(Schema.Boolean),
  fire_immediately: optional(Schema.Boolean),
})

export const node = makeLocationNode({
  name: "tool/scheduler",
  deps: [
    ToolRegistry.node,
    PermissionV2.node,
    AgentV2.node,
    SessionStore.node,
    SessionManagedChild.node,
    SessionTaskRole.node,
    SessionTaskStore.node,
    SessionScheduleRuntime.node,
    SessionScheduleStore.node,
    SessionRunnerModel.node,
    SessionLifecycle.node,
  ],
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const tools = yield* Tools.Service
      const permission = yield* PermissionV2.Service
      const agents = yield* AgentV2.Service
      const sessions = yield* SessionStore.Service
      const managed = yield* SessionManagedChild.Service
      const roles = yield* SessionTaskRole.Service
      const tasks = yield* SessionTaskStore.Service
      const schedules = yield* SessionScheduleStore.Service
      const runtime = yield* SessionScheduleRuntime.Service
      const models = yield* SessionRunnerModel.Service
      const lifecycle = yield* SessionLifecycle.Service
      const failure = (error: unknown) =>
        new Tool.Failure({
          message: error instanceof SessionScheduleRecord.Failure ? error.message : "Native schedule operation failed",
        })
      const target = (context: Tool.Context, id?: SessionSchedule.ID) =>
        Effect.gen(function* () {
          const role = roles.get(context.sessionID)
          if (role?.scheduledLaunchID) {
            const launch = yield* tasks.launch(role.scheduledLaunchID)
            const record = yield* tasks.owned(role.record.parentID, context.sessionID)
            if (
              !launch?.origin ||
              launch.owner !== tasks.owner ||
              launch.status !== "running" ||
              launch.sessionID !== context.sessionID ||
              launch.parentID !== record.parentID ||
              record.parentCreated !== role.record.parentCreated ||
              record.childCreated !== role.record.childCreated ||
              launch.origin.scheduleID !== record.scheduleID ||
              (id && id !== record.scheduleID)
            )
              return yield* new SessionScheduleRecord.Failure({
                code: "denied",
                message: "Scheduled child cannot access this intent",
              })
            const admission = yield* schedules.admission(launch.origin.occurrenceID)
            if (
              admission.launchID !== launch.id ||
              admission.childID !== context.sessionID ||
              admission.origin.scheduleID !== record.scheduleID
            )
              return yield* new SessionScheduleRecord.Failure({
                code: "denied",
                message: "Scheduled occurrence authority is unavailable",
              })
            return { sessionID: record.parentID, own: launch.origin.scheduleID }
          }
          if ((yield* SessionGoalUsage.Current) || (yield* managed.managed(context.sessionID)))
            return yield* new SessionScheduleRecord.Failure({
              code: "denied",
              message: "Managed children and Goal workers cannot manage schedules",
            })
          return { sessionID: context.sessionID, own: undefined }
        })
      const assert = (context: Tool.Context, action: string, resources: string[]) =>
        permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          action,
          resources,
          save: ["*"],
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })
      yield* tools
        .register({
          scheduler_create: Tool.make({
            description:
              "Create a recurring native schedule or update task_id in place. interval uses whole seconds/minutes/hours/days (5m); minimum 60 seconds. Fires use the native general subagent. durable defaults to false. Saved Session intent remains available after restart; native timers currently require explicit Resume. An originating scheduled child may only update its own intent.",
            input: Create,
            output: Schema.Struct({
              id: SessionSchedule.ID,
              updated: Schema.Boolean,
              schedule: SessionSchedule.Detail,
            }),
            execute: (input, context) =>
              lifecycle
                .run(
                  context.sessionID,
                  Effect.gen(function* () {
                    const owner = yield* target(context, input.task_id)
                    if (owner.own && !input.task_id)
                      return yield* new SessionScheduleRecord.Failure({
                        code: "denied",
                        message: "Scheduled children cannot create additional schedules",
                      })
                    const intervalSeconds = input.interval === undefined ? undefined : parseInterval(input.interval)
                    if (input.interval !== undefined && intervalSeconds === undefined)
                      return yield* new SessionScheduleRecord.Failure({
                        code: "invalid",
                        message: "Interval must be a positive whole number with s, m, h or d suffix",
                      })
                    yield* assert(context, "scheduler_create", [input.task_id ?? input.prompt ?? "*"])
                    if (input.task_id) {
                      yield* schedules.update(owner.sessionID, input.task_id, { prompt: input.prompt, intervalSeconds })
                      yield* runtime.signal(owner.sessionID)
                      return {
                        id: input.task_id,
                        updated: true,
                        schedule: yield* schedules.detail(owner.sessionID, input.task_id),
                      }
                    }
                    if (input.recurring === false)
                      return yield* new SessionScheduleRecord.Failure({
                        code: "invalid",
                        message: "One-shot schedules are unavailable; use a background Shell command",
                      })
                    if (!input.prompt || intervalSeconds === undefined)
                      return yield* new SessionScheduleRecord.Failure({
                        code: "invalid",
                        message: "New schedules require a prompt and interval",
                      })
                    // Capture immutable native selection and restrictions; every fire also revalidates current configuration.
                    const parent = yield* sessions.get(owner.sessionID)
                    const agent = yield* agents.resolve("general")
                    if (!parent || !agent || agent.hidden || agent.mode === "primary")
                      return yield* new SessionScheduleRecord.Failure({
                        code: "invalid",
                        message: "Native general subagent is unavailable",
                      })
                    const model = agent.model ?? parent.model
                    if (!model)
                      return yield* new SessionScheduleRecord.Failure({
                        code: "invalid",
                        message: "Select a native model before creating a schedule",
                      })
                    yield* models.resolve({ ...parent, agent: agent.id, model })
                    yield* assert(context, "task", [agent.id])
                    const authority = yield* permission.capture(parent.id, context.agent)
                    const claim = yield* runtime.bind(parent.id)
                    yield* runtime.joinStop(claim)
                    const result = yield* schedules.create({
                      sessionID: parent.id,
                      messageID: context.assistantMessageID,
                      callID: context.toolCallID,
                      request: {
                        prompt: input.prompt,
                        intervalSeconds,
                        durable: input.durable ?? false,
                        fireImmediately: input.fire_immediately ?? false,
                      },
                      authority: {
                        parentAgent: context.agent,
                        agent: agent.id,
                        model,
                        authority,
                        permissionSource: {
                          type: "tool",
                          messageID: context.assistantMessageID,
                          callID: context.toolCallID,
                        },
                      },
                    })
                    yield* runtime.changed(parent.id, true)
                    return {
                      id: result.record.id,
                      updated: !result.created,
                      schedule: yield* schedules.detail(parent.id, result.record.id),
                    }
                  }),
                )
                .pipe(Effect.mapError(failure)),
          }),
          scheduler_list: Tool.make({
            description:
              "Read owned schedule intent without waking a provider. A scheduled child sees only its own originating intent.",
            input: Schema.Struct({}),
            output: Schema.Array(SessionSchedule.Detail),
            execute: (_, context) =>
              lifecycle
                .read(
                  context.sessionID,
                  Effect.gen(function* () {
                    const owner = yield* target(context)
                    yield* assert(context, "scheduler_list", [owner.own ?? "*"])
                    const items = owner.own
                      ? [yield* schedules.owned(owner.sessionID, owner.own)]
                      : yield* schedules.list(owner.sessionID)
                    return yield* Effect.forEach(
                      items.filter((item) => schedules.state(item, Date.now()).status !== "deleted"),
                      (item) => schedules.detail(owner.sessionID, item.id),
                    )
                  }),
                )
                .pipe(Effect.mapError(failure)),
          }),
          scheduler_delete: Tool.make({
            description:
              "Delete future schedule intent. An admitted Task remains independently controllable through Task output/wait/cancel.",
            input: Schema.Struct({ task_id: SessionSchedule.ID }),
            output: Schema.Struct({ success: Schema.Boolean }),
            execute: (input, context) =>
              lifecycle
                .run(
                  context.sessionID,
                  Effect.gen(function* () {
                    const owner = yield* target(context, input.task_id)
                    yield* assert(context, "scheduler_delete", [input.task_id])
                    yield* schedules.remove(owner.sessionID, input.task_id)
                    yield* runtime.signal(owner.sessionID)
                    return { success: true }
                  }),
                )
                .pipe(Effect.mapError(failure)),
          }),
        })
        .pipe(Effect.orDie)
    }),
  ),
})

function parseInterval(value: string) {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim())
  if (!match || Number(match[1]) <= 0) return
  const seconds = Number(match[1]) * (match[2] === "d" ? 86400 : match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1)
  if (!Number.isSafeInteger(seconds * 1000) || Date.now() + seconds * 1000 > 8_640_000_000_000_000) return
  return Math.max(60, seconds)
}
