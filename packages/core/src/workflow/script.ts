export * as WorkflowScript from "./script"

import { createHash } from "node:crypto"
import { Effect, FileSystem, Queue, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Workflow } from "@apexo/schema/workflow"
import { SessionID } from "@apexo/schema/session-id"
import { Agent } from "@apexo/schema/agent"
import { ModelV2 } from "../model"
import { AppProcess } from "../process"
import { WorkflowEngine } from "./engine"
import { WorkflowStore } from "./store"
import { WorkflowEffort } from "./effort"
import { WorkflowLimits } from "./limits"
import { WorkflowInterpreter } from "./interpreter"

const Options = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000)),
  label: Schema.optional(Schema.String),
  resume_from: Schema.optional(SessionID),
  isolation_worktree: Schema.optional(Schema.Boolean),
  agent_type: Schema.optional(Agent.ID.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  model: Schema.optional(Schema.String.check(Schema.isPattern(/^[^\s/]+\/[^\s]+$/))),
  effort: Schema.optional(Schema.String.check(Schema.isPattern(WorkflowEffort.pattern))),
  capability_mode: Schema.optional(Schema.Literals(["read-only", "default"])),
  output_schema: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
})
const Reply = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.Number),
  kind: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Json),
  value: Schema.optional(Schema.Json),
  message: Schema.optional(Schema.String),
})
export function make(
  store: WorkflowStore.Interface,
  processes: AppProcess.Interface,
  filesystem: FileSystem.FileSystem,
  host: (
    state: WorkflowStore.State,
    kind: string,
    payload: unknown,
  ) => Effect.Effect<Workflow.ChildResult["output"], WorkflowStore.Failure>,
): WorkflowEngine.Script {
  return (initial, driver) =>
    Effect.scoped(
      Effect.gen(function* () {
        const executable = yield* WorkflowInterpreter.executable(filesystem)
        const replies = yield* Queue.unbounded<Uint8Array>()
        const child = yield* processes.spawn(
          ChildProcess.make(executable, [], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }),
        )
        yield* Stream.fromQueue(replies).pipe(Stream.run(child.stdin), Effect.forkChild)
        yield* child.stderr.pipe(Stream.runDrain, Effect.forkChild)
        const send = (value: unknown) => Queue.offer(replies, new TextEncoder().encode(`${JSON.stringify(value)}\n`))
        yield* send({ version: 1, script: initial.script, args: initial.args })
        let outcome:
          | {
              status: "completed" | "paused" | "budget_limited"
              result?: Workflow.ChildResult["output"]
              message?: string
              pauseKind?: Workflow.PauseKind
            }
          | undefined
        let lineBytes = 0
        yield* child.stdout.pipe(
          Stream.mapEffect((chunk) =>
            Effect.try({
              try: () => {
                for (const byte of chunk) {
                  lineBytes = byte === 10 ? 0 : lineBytes + 1
                  if (lineBytes > WorkflowLimits.valueBytes + 1024)
                    throw new Error("Workflow interpreter message capacity exceeded")
                }
                return chunk
              },
              catch: (error) => new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
            }),
          ),
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.gen(function* () {
              const message = yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(line).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Reply)),
              )
              if (message.type === "complete") {
                yield* Effect.try({
                  try: () => WorkflowLimits.value(message.value),
                  catch: (error) => new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
                })
                outcome = { status: "completed", result: message.value ?? null }
                return
              }
              if (message.type === "paused") {
                const pauseKind = yield* Schema.decodeUnknownEffect(Workflow.PauseKind)(message.kind)
                outcome = { status: "paused", pauseKind, message: message.message ?? "Script paused" }
                return
              }
              if (message.type === "error")
                return yield* new WorkflowStore.Failure({
                  code: "invalid",
                  message: message.message ?? "Workflow script failed",
                })
              if (
                message.type !== "call" ||
                message.id === undefined ||
                !Number.isSafeInteger(message.id) ||
                message.id < 0 ||
                message.id >= WorkflowLimits.hostCalls
              )
                return yield* new WorkflowStore.Failure({
                  code: "invalid",
                  message: "Invalid workflow interpreter protocol",
                })
              yield* Effect.try({
                try: () => WorkflowLimits.value(message.payload),
                catch: (error) => new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
              })
              const id = message.id
              const hash = createHash("sha256")
                .update(JSON.stringify({ kind: message.kind, payload: message.payload }))
                .digest("hex")
              const state = yield* store.read(initial.info.sessionID, initial.info.id)
              const prior = state.calls.find((call) => call.id === id)
              if (prior) {
                if (prior.hash !== hash)
                  return yield* new WorkflowStore.Failure({ code: "stale", message: "Saved workflow replay diverged" })
                yield* send({ id, value: prior.result })
                return
              }
              if (id !== state.calls.length)
                return yield* new WorkflowStore.Failure({
                  code: "stale",
                  message: "Workflow call sequence is not contiguous",
                })
              yield* Effect.try({
                try: () => WorkflowLimits.admit(state.calls),
                catch: (error) => new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
              })
              if (message.kind === "await_user") {
                const input = yield* Schema.decodeUnknownEffect(
                  Schema.Struct({ kind: Workflow.PauseKind, message: Schema.String }),
                )(message.payload)
                yield* store.change(initial.info.sessionID, initial.info.id, (current) => {
                  if (current.info.status !== "running")
                    throw new WorkflowStore.Failure({
                      code: "busy",
                      message: "Workflow stopped before user checkpoint",
                    })
                  return {
                    ...current,
                    calls: [...current.calls, { id, hash, result: null }],
                    info: { ...current.info, status: "paused", pauseKind: input.kind, message: input.message },
                  }
                })
                outcome = { status: "paused", pauseKind: input.kind, message: input.message }
                yield* child.kill()
                return
              }
              let result: Workflow.ChildResult["output"] = null
              if (message.kind === "agent" || message.kind === "parallel") {
                const values = message.kind === "agent" ? [message.payload] : message.payload
                const tasks = yield* Schema.decodeUnknownEffect(
                  Schema.Array(Options).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
                )(values, { onExcessProperty: "error" })
                // A parallel panel can mix read-only and ordinary children; each task retains its own policy.
                const stage: Workflow.Stage = { name: `script-${id}`, prompt: "Saved workflow child" }
                const byKey = new Map(tasks.map((task, index) => [`${stage.name}:${index}`, task]))
                const panel = yield* WorkflowEngine.panel(
                  store,
                  initial.info.sessionID,
                  initial.info.id,
                  stage,
                  tasks.map((task, index) => ({
                    key: `${stage.name}:${index}`,
                    prompt: `${task.prompt}${task.output_schema ? `\nReturn only JSON matching: ${JSON.stringify(task.output_schema)}` : ""}`,
                    hash: createHash("sha256").update(JSON.stringify(task)).digest("hex"),
                  })),
                  (task) => {
                    const options = byKey.get(task.key)!
                    const model = options.model ? ModelV2.parse(options.model) : undefined
                    return driver({
                      ...task,
                      effort: options.effort,
                      agent: options.agent_type,
                      resumeFrom: options.resume_from,
                      worktree: options.isolation_worktree,
                      stage: {
                        ...task.stage,
                        readOnly: options.capability_mode === "read-only",
                        outputSchema: options.output_schema,
                        model: model ? { providerID: model.providerID, id: model.modelID } : undefined,
                      },
                    })
                  },
                )
                if (!panel) {
                  outcome = { status: "budget_limited", message: "Increase the agent budget before resuming" }
                  yield* child.kill()
                  return
                }
                const results = panel.map((value) => ({
                  agent_id: value.sessionID,
                  success: true,
                  output: value.output,
                  cancelled: false,
                  tokens_used: value.tokens,
                  duration_ms: 0,
                }))
                result = message.kind === "agent" ? results[0] : results
              } else if (message.kind === "budget") {
                result = {
                  total: state.info.agentBudget,
                  spent: state.info.agentsSpent,
                  reserved: 0,
                  remaining: state.info.agentBudget - state.info.agentsSpent,
                }
              } else if (message.kind === "phase" || message.kind === "log") {
                const value = yield* Schema.decodeUnknownEffect(Schema.Struct({ value: Schema.String }))(
                  message.payload,
                )
                if (message.kind === "phase")
                  yield* store.change(initial.info.sessionID, initial.info.id, (current) => ({
                    ...current,
                    info: { ...current.info, phase: value.value.slice(0, 128) },
                  }))
              } else result = yield* host(state, message.kind ?? "", message.payload)
              yield* Effect.try({
                try: () => WorkflowLimits.value(result),
                catch: (error) => new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
              })
              yield* store.change(initial.info.sessionID, initial.info.id, (current) => ({
                ...current,
                calls: [...current.calls, { id, hash, result }],
              }))
              yield* send({ id, value: result })
            }),
          ),
        )
        if (!outcome)
          return yield* new WorkflowStore.Failure({
            code: "invalid",
            message: "Workflow interpreter exited without an outcome",
          })
        return outcome
      }),
    ).pipe(
      Effect.mapError((error) =>
        error instanceof WorkflowStore.Failure
          ? error
          : new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
      ),
    )
}
