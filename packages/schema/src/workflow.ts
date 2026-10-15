export * as Workflow from "./workflow"

import { Schema } from "effect"
import { descending } from "./identifier"
import { NonNegativeInt, PositiveInt, optional, statics } from "./schema"
import { SessionID } from "./session-id"
import { Agent } from "./agent"
import { Model } from "./model"

export const ID = Schema.String.check(Schema.isPattern(/^workflow_[a-zA-Z0-9]+$/)).pipe(
  Schema.brand("Workflow.ID"),
  Schema.annotate({ identifier: "Workflow.ID" }),
  statics((schema) => ({ create: () => schema.make(`workflow_${descending()}`) })),
)
export type ID = typeof ID.Type
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64_000))
export const AgentBudget = PositiveInt.check(Schema.isLessThanOrEqualTo(1024))
export const Stage = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)),
  prompt: Text,
  readOnly: optional(Schema.Boolean),
  /** Explicit child model; omitted selections inherit the Workflow parent. */
  model: optional(Model.Ref),
  /** An earlier stage's output is supplied as untrusted JSON to each child. */
  input: optional(Schema.String),
  /** Expand an array property of the earlier stage's single JSON output. */
  foreach: optional(Schema.String),
  limit: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(32))),
  outputSchema: optional(Schema.Record(Schema.String, Schema.Json)),
})
export type Stage = typeof Stage.Type
export const Definition = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)),
  description: Text,
  stages: Schema.Array(Stage).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
})
export type Definition = typeof Definition.Type
export const Source = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("saved"),
    name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)),
  }),
  Schema.Struct({
    type: Schema.Literal("script"),
    name: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/)),
    script: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512_000)),
  }),
  Schema.Struct({ type: Schema.Literal("definition"), definition: Definition }),
  Schema.Struct({ type: Schema.Literal("builtin"), name: Schema.Literal("deep-research") }),
]).annotate({ identifier: "Workflow.Source" })
export type Source = typeof Source.Type
export const Start = Schema.Struct({
  source: Source,
  args: optional(Schema.Json),
  agentBudget: optional(AgentBudget),
  concurrency: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(16))),
}).annotate({ identifier: "Workflow.Start" })
export type Start = typeof Start.Type
export const Launch = Schema.Struct({
  ...Start.fields,
  model: optional(Model.Ref),
  agent: optional(Agent.ID),
}).annotate({ identifier: "Workflow.Launch" })
export type Launch = typeof Launch.Type
export const PauseKind = Schema.Literals(["user", "back_off", "no_progress", "verification", "infra"]).annotate({
  identifier: "Workflow.PauseKind",
})
export type PauseKind = Schema.Schema.Type<typeof PauseKind>

export const Status = Schema.Literals([
  "pending",
  "running",
  "paused",
  "budget_limited",
  "cancelled",
  "completed",
  "failed",
])
export const ChildResult = Schema.Struct({
  sessionID: SessionID,
  output: Schema.Json,
  tokens: NonNegativeInt,
})
export type ChildResult = typeof ChildResult.Type
export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  name: Schema.String,
  status: Status,
  phase: optional(Schema.String),
  agentBudget: AgentBudget,
  agentsSpent: NonNegativeInt,
  concurrency: PositiveInt,
  tokens: NonNegativeInt,
  /** True when tokens are a known lower bound because a provider receipt is incomplete. */
  usageIncomplete: optional(Schema.Boolean),
  /** Read-only recovery guidance, derived from current process ownership and durable attempt claims. */
  resumeBlockedReason: optional(Schema.Literals(["process_restart", "schema_attempt_claimed"])),
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  message: optional(Schema.String),
  pauseKind: optional(PauseKind),
  result: optional(Schema.Json),
  children: Schema.Array(SessionID),
}).annotate({ identifier: "Workflow.Info" })
export type Info = typeof Info.Type
export const Resume = Schema.Struct({ agentBudget: optional(AgentBudget) })

export const SourceEntry = Schema.Struct({
  name: Schema.String,
  scope: Schema.Literals(["builtin", "project", "user"]),
  description: optional(Schema.String),
}).annotate({ identifier: "Workflow.SourceEntry" })
export type SourceEntry = typeof SourceEntry.Type
export const Validation = Schema.Struct({
  name: Schema.String,
  valid: Schema.Boolean,
  diagnostics: Schema.Array(Schema.String),
}).annotate({ identifier: "Workflow.Validation" })
export type Validation = typeof Validation.Type
