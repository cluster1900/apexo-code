export * as SessionRunner from "./index"

import type { SessionCompaction } from "../compaction"
import type { SessionHookSnapshot } from "../hook-snapshot"
import type { WorkflowStore } from "../../workflow/store"
import type { SessionGoal } from "../goal"
import type { LLMError } from "@apexo/llm"
import { Context, Effect } from "effect"
import { SessionSchema } from "../schema"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

import { HookPreferences } from "../../hook-preferences"

export type RunError =
  | import("../history-copy").SessionHistoryCopy.Conflict
  | import("../input-execution").SessionInputExecution.Failure
  | import("../schedule-record").SessionScheduleRecord.Failure
  | import("../memory-mode-native").SessionMemoryModeNative.Failure
  | import("../plan").SessionPlan.Failure
  | import("../process-store").SessionProcessStore.Failure
  | import("../managed-child").SessionManagedChild.Failure
  | HookPreferences.Failure
  | import("../task-store").SessionTaskStore.Failure
  | SessionHookSnapshot.Failure
  | WorkflowStore.Failure
  | SessionGoal.Error
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | SystemContext.InitializationBlocked
  | ToolOutputStore.Error
  | import("../execution-store").SessionExecutionStore.Failure

export type CompactError = RunError | SessionCompaction.Failure

export type Children = {
  /** Read-only view of the existing process-local coordinator, used for source admission. */
  readonly active?: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly run: (sessionID: SessionSchema.ID) => Effect.Effect<void, RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Advisory wake for an internally owned parent completion, never arbitrary child input. */
  readonly notify?: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/** Capability supplied only by the owning process-local Session execution chain. */
export const CurrentChildren = Context.Reference<Children | undefined>("@apexo/SessionRunner/Children", {
  defaultValue: () => undefined,
})

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  readonly compact: (sessionID: SessionSchema.ID) => Effect.Effect<void, CompactError>
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
    readonly children?: Children
    /** Runs trusted queued controls at a safe provider-turn boundary. */
    readonly controls?: Effect.Effect<void>
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@apexo/v2/SessionRunner") {}
