export * as Goal from "./goal"

import { Schema } from "effect"
import { descending } from "./identifier"
import { NonNegativeInt, PositiveInt, optional, statics } from "./schema"
import { SessionID } from "./session-id"
import { Model } from "./model"
import { SessionMessage } from "./session-message"

export const ID = Schema.String.check(Schema.isPattern(/^goal_[a-zA-Z0-9]+$/)).pipe(
  Schema.brand("Goal.ID"),
  Schema.annotate({ identifier: "Goal.ID" }),
  statics((schema) => ({ create: () => schema.make(`goal_${descending()}`) })),
)
export type ID = typeof ID.Type

export const Status = Schema.Literals([
  "active",
  "user_paused",
  "back_off_paused",
  "no_progress_paused",
  "infra_paused",
  "blocked",
  "budget_limited",
  "complete",
]).annotate({ identifier: "Goal.Status" })
export type Status = typeof Status.Type

export const Phase = Schema.Literals(["idle", "planning", "executing", "evaluating", "verifying"]).annotate({
  identifier: "Goal.Phase",
})
export type Phase = typeof Phase.Type

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32_768))
const Tokens = NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))

export const VerifierCount = PositiveInt.check(Schema.isLessThanOrEqualTo(5))

export interface RoleModel extends Schema.Schema.Type<typeof RoleModel> {}
export const RoleModel = Schema.Struct({
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  agent_type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
}).annotate({ identifier: "Goal.RoleModel" })

export interface RoleExecution extends Schema.Schema.Type<typeof RoleExecution> {}
export const RoleExecution = Schema.Struct({
  requested: optional(RoleModel),
  model: Model.Ref,
  agent: Schema.String,
  fallback: optional(Schema.Literals(["model_unavailable", "agent_unavailable", "agent_incapable", "spawn_failed"])),
}).annotate({ identifier: "Goal.RoleExecution" })

export interface Verification extends Schema.Schema.Type<typeof Verification> {}
export const Verification = Schema.Struct({
  achieved: Schema.Boolean,
  evidence: Text,
  unmet: Schema.Array(Text),
}).annotate({ identifier: "Goal.Verification" })

export interface Verdict extends Schema.Schema.Type<typeof Verdict> {}
export const Verdict = Schema.Struct({
  ...Verification.fields,
  confidence: Schema.Literals(["high", "medium", "low"]),
  blocking: Schema.Literals(["none", "contradiction", "unverifiable"]),
}).annotate({ identifier: "Goal.Verdict" })

export const File = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  bytes: NonNegativeInt,
}).annotate({ identifier: "Goal.File" })
export type File = typeof File.Type

export const ReviewFiles = Schema.Struct({
  directory: Schema.String,
  objective: File,
  evidence: File,
  plan: File,
  verdict: optional(File),
  details: optional(File),
  strategy: optional(File),
  changes: optional(File),
  changedFiles: optional(File),
  workerScratch: Schema.String,
}).annotate({ identifier: "Goal.ReviewFiles" })
export type ReviewFiles = typeof ReviewFiles.Type

export const ReportID = Schema.String.check(Schema.isPattern(/^review-[a-zA-Z0-9]+$/)).annotate({
  identifier: "Goal.ReportID",
})
export const ReportFileKey = Schema.Literals([
  "objective",
  "evidence",
  "plan",
  "verdict",
  "details",
  "strategy",
  "changes",
  "changedFiles",
]).annotate({ identifier: "Goal.ReportFileKey" })
export type ReportFileKey = typeof ReportFileKey.Type

export interface Report extends Schema.Schema.Type<typeof Report> {}
export const Report = Schema.Struct({
  id: ReportID,
  kind: Schema.Literals(["planning", "verifying", "strategizing"]),
  createdAt: optional(NonNegativeInt),
  complete: Schema.Boolean,
  files: Schema.Array(
    Schema.Struct({
      key: ReportFileKey,
      name: Schema.String,
      bytes: NonNegativeInt,
      sha256: File.fields.sha256,
    }),
  ),
}).annotate({ identifier: "Goal.Report" })

export interface ReportContent extends Schema.Schema.Type<typeof ReportContent> {}
export const ReportContent = Schema.Struct({
  name: Schema.String,
  contentType: Schema.String,
  text: Schema.String,
  bytes: NonNegativeInt,
  sha256: File.fields.sha256,
}).annotate({ identifier: "Goal.ReportContent" })

export interface ReportCleanup extends Schema.Schema.Type<typeof ReportCleanup> {}
export const ReportCleanup = Schema.Struct({
  removed: NonNegativeInt,
  failed: Schema.Array(ReportID),
}).annotate({ identifier: "Goal.ReportCleanup" })

export interface Reviewer extends Schema.Schema.Type<typeof Reviewer> {}
export const Reviewer = Schema.Struct({
  ...Verdict.fields,
  index: NonNegativeInt.check(Schema.isLessThanOrEqualTo(4)),
  callID: Schema.String.check(Schema.isMinLength(1)),
  sessionID: optional(SessionID),
  execution: optional(RoleExecution),
  files: optional(ReviewFiles),
  tokensUsed: Tokens,
  elapsedMs: NonNegativeInt,
}).annotate({ identifier: "Goal.Reviewer" })

export interface Panel extends Schema.Schema.Type<typeof Panel> {}
export const Panel = Schema.Struct({
  count: VerifierCount,
  round: PositiveInt,
  evidenceSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  results: Schema.Array(Reviewer).check(Schema.isMaxLength(5)),
  previous: optional(Reviewer),
}).annotate({ identifier: "Goal.Panel" })

export interface Evaluation extends Schema.Schema.Type<typeof Evaluation> {}
export const Evaluation = Schema.Struct({
  decision: Schema.Literals(["continue", "candidate_complete", "blocked"]),
  evidence: Text,
  next_step: Text,
  blocker_key: Schema.String.check(Schema.isMaxLength(1024), Schema.isPattern(/^[a-z0-9_]*$/)),
}).annotate({ identifier: "Goal.Evaluation" })

export interface Create extends Schema.Schema.Type<typeof Create> {}
export const Create = Schema.Struct({
  id: ID,
  objective: Text,
  tokenBudget: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))),
}).annotate({ identifier: "Goal.Create" })

export interface Start extends Schema.Schema.Type<typeof Start> {}
export const Start = Schema.Struct({
  model: Model.Ref,
  agent: Schema.String.check(Schema.isMinLength(1)),
}).annotate({ identifier: "Goal.Start" })

export interface Launch extends Schema.Schema.Type<typeof Launch> {}
export const Launch = Schema.Struct({
  ...Start.fields,
  messageID: SessionMessage.ID,
}).annotate({ identifier: "Goal.Launch" })

const PlanOrdinal = NonNegativeInt.check(Schema.isLessThanOrEqualTo(127))
const Deviation = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)).annotate({
  description:
    "A concise advisory deviation; at most 512 UTF-8 bytes after trimming. Never changes the objective or acceptance criteria.",
})
export const PlanProgress = Schema.Struct({
  completed: Schema.Array(PlanOrdinal).check(Schema.isMaxLength(128)),
  deviations: Schema.Array(Deviation).check(Schema.isMaxLength(16)),
}).annotate({ identifier: "Goal.PlanProgress" })
export type PlanProgress = typeof PlanProgress.Type
export const PlanProgressUpdate = Schema.Struct({
  complete: optional(Schema.Array(PlanOrdinal).check(Schema.isMaxLength(128))),
  deviation: optional(Deviation),
}).annotate({ identifier: "Goal.PlanProgressUpdate" })
export type PlanProgressUpdate = typeof PlanProgressUpdate.Type

export interface Update extends Schema.Schema.Type<typeof Update> {}
export const Update = Schema.Struct({
  plan_progress: optional(PlanProgressUpdate),
  completed: optional(Schema.Boolean),
  message: optional(Text),
  blocked_reason: optional(Text),
}).annotate({ identifier: "Goal.Update" })

export interface History extends Schema.Schema.Type<typeof History> {}
export const History = Schema.Struct({
  at: NonNegativeInt,
  event: Schema.Literals([
    "created",
    "resumed",
    "paused",
    "recovered",
    "planning_started",
    "planning_completed",
    "worker_started",
    "worker_completed",
    "evaluation_started",
    "evaluation_completed",
    "progress",
    "completion_requested",
    "verification_started",
    "verification_rejected",
    "completed",
    "budget_exceeded",
    "usage_incomplete",
  ]),
  message: optional(Text),
  tokensUsed: Tokens,
}).annotate({ identifier: "Goal.History" })

export const Strategy = Schema.Struct({
  round: PositiveInt,
  workerRound: PositiveInt,
  status: Schema.Literals(["running", "advised", "failed"]),
  recommendation: optional(Text),
  failure: optional(Text),
  sessionID: optional(SessionID),
  execution: optional(RoleExecution),
  files: optional(ReviewFiles),
}).annotate({ identifier: "Goal.Strategy" })
export type Strategy = typeof Strategy.Type

export const Summary = Schema.Struct({
  status: Schema.Literals(["running", "completed", "failed", "skipped"]),
  sessionID: optional(SessionID),
  text: optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2400))),
  reason: optional(Schema.Literals(["disabled", "budget", "interrupted", "provider", "output", "usage", "execution"])),
  model: optional(Model.Ref),
  tokensUsed: optional(Tokens),
  startedAt: optional(NonNegativeInt),
  finishedAt: optional(NonNegativeInt),
}).annotate({ identifier: "Goal.Summary" })
export type Summary = typeof Summary.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  objective: Text,
  status: Status,
  launch: optional(Launch),
  phase: Phase,
  tokenBudget: optional(PositiveInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))),
  tokensUsed: Tokens,
  usageIncomplete: optional(Schema.Boolean),
  elapsedMs: NonNegativeInt,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt,
  revision: NonNegativeInt,
  workerRounds: NonNegativeInt,
  verificationRounds: NonNegativeInt,
  message: optional(Text),
  plan: optional(Text),
  planProgress: optional(PlanProgress),
  plannerSessionID: optional(SessionID),
  plannerExecution: optional(RoleExecution),
  plannerFiles: optional(ReviewFiles),
  strategy: optional(Strategy),
  summary: optional(Summary),
  changesBaselineCommit: optional(Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))),
  skepticModels: optional(Schema.Array(RoleModel).check(Schema.isMaxLength(5))),
  evaluation: optional(Evaluation),
  verification: optional(Panel),
  unmet: Schema.Array(Text),
  history: Schema.Array(History),
}).annotate({ identifier: "Goal.Info" })
