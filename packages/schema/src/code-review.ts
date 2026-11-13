export * as CodeReview from "./code-review"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { define, inventory } from "./event"
import { Model } from "./model"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"
import { SessionInput } from "./session-input"
import { NonNegativeInt, optional, statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("rev_")).pipe(
  Schema.brand("CodeReview.ID"),
  statics((schema) => ({ create: () => schema.make("rev_" + ascending()) })),
)
export type ID = typeof ID.Type
export const Priority = Schema.Literals(["P0", "P1", "P2", "P3"])
export type Priority = typeof Priority.Type
export const Target = Schema.Union([
  Schema.Struct({ type: Schema.Literal("uncommitted") }),
  Schema.Struct({ type: Schema.Literal("base"), ref: Schema.String }),
  Schema.Struct({ type: Schema.Literal("commit"), ref: Schema.String }),
  Schema.Struct({ type: Schema.Literal("pr"), ref: Schema.String }),
]).annotate({ identifier: "CodeReview.Target" })
export type Target = typeof Target.Type
export const Input = Schema.Struct({
  id: ID.pipe(optional),
  target: Target,
  focus: Schema.String.pipe(optional),
  title: Schema.String.pipe(optional),
  model: Model.Ref.pipe(optional),
  // Override the variant while leaving model choice to native configured-default resolution.
  variant: Model.VariantID.pipe(optional),
  agent: Schema.String.pipe(optional),
  limits: SessionInput.ExecutionPolicy.pipe(optional),
}).annotate({ identifier: "CodeReview.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Exclusion = Schema.Struct({ path: Schema.String, reason: Schema.String })
export const CapturedFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.String.pipe(optional),
  status: Schema.Literals(["added", "modified", "deleted", "renamed"]),
  patch: Schema.String,
})
export const Captured = Schema.Struct({
  root: Schema.String,
  baseSha: Schema.String,
  headSha: Schema.String,
  mergeBaseSha: Schema.String.pipe(optional),
  beforeTree: Schema.String,
  afterTree: Schema.String,
  files: Schema.Array(CapturedFile),
  exclusions: Schema.Array(Exclusion),
}).annotate({ identifier: "CodeReview.Captured" })
export interface Captured extends Schema.Schema.Type<typeof Captured> {}
export const Anchor = Schema.Union([
  Schema.Struct({ type: Schema.Literal("file") }),
  Schema.Struct({
    type: Schema.Literal("line"),
    side: Schema.Literals(["old", "new"]),
    startLine: Schema.Int.check(Schema.isGreaterThan(0)),
    endLine: Schema.Int.check(Schema.isGreaterThan(0)),
    inHunk: Schema.Boolean,
    snippet: Schema.Struct({ startLine: Schema.Int, text: Schema.String }).pipe(optional),
  }),
])
export const Finding = Schema.Struct({
  id: Schema.String,
  priority: Priority,
  title: Schema.String,
  explanation: Schema.String,
  confidence: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  path: Schema.String,
  anchor: Anchor,
}).annotate({ identifier: "CodeReview.Finding" })
export interface Finding extends Schema.Schema.Type<typeof Finding> {}

// The model supplies citations; IDs, validated anchors and coverage belong to the host.
export const Output = Schema.Struct({
  summary: Schema.String.check(Schema.isMaxLength(10_000)),
  assessment: Schema.Literals(["issues_found", "no_findings", "inconclusive"]),
  findings: Schema.Array(
    Schema.Struct({
      priority: Priority,
      title: Schema.String.check(Schema.isMaxLength(500)),
      explanation: Schema.String.check(Schema.isMaxLength(5000)),
      confidence: Finding.fields.confidence,
      path: Schema.String,
      side: Schema.Literals(["old", "new"]),
      startLine: Schema.Number,
      endLine: Schema.Number,
    }),
  ).check(Schema.isMaxLength(200)),
}).annotate({ identifier: "CodeReview.Output" })
export interface Output extends Schema.Schema.Type<typeof Output> {}
export const Result = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  summary: Schema.String,
  assessment: Output.fields.assessment,
  findings: Schema.Array(Finding),
  coverage: Schema.Struct({ exclusions: Schema.Array(Exclusion), invalidLocations: NonNegativeInt }),
  model: Model.Ref.pipe(optional),
  tokens: NonNegativeInt,
  cost: Schema.Number,
}).annotate({ identifier: "CodeReview.Result" })
export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Run = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  reviewSessionID: SessionID,
  inputID: SessionMessage.ID,
  input: Input,
  revision: NonNegativeInt,
  status: Schema.Literals(["admitted", "capturing", "running", "completed", "failed", "cancelled", "interrupted"]),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  captured: Captured.pipe(optional),
  result: Result.pipe(optional),
  error: Schema.String.pipe(optional),
  // Computed on detail reads; never used as persisted execution state.
  workspaceStatus: Schema.Literals(["current", "stale", "unavailable", "not_applicable"]).pipe(optional),
}).annotate({ identifier: "CodeReview.Run" })
export interface Run extends Schema.Schema.Type<typeof Run> {}
const progress = { sessionID: SessionID, reviewID: ID, revision: NonNegativeInt, status: Run.fields.status }
const Started = define({ type: "code_review.started", schema: progress })
const Updated = define({ type: "code_review.updated", schema: progress })
const Finished = define({ type: "code_review.finished", schema: progress })
export const Event = { Started, Updated, Finished, Definitions: inventory(Started, Updated, Finished) }

export const terminal = (run: Run) => !["admitted", "capturing", "running"].includes(run.status)
