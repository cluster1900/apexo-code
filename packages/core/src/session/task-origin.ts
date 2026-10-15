export * as SessionTaskOrigin from "./task-origin"

import { Context, Schema } from "effect"
import { Model } from "@apexo/schema/model"
import { Permission } from "@apexo/schema/permission"
import { SessionSchedule } from "@apexo/schema/session-schedule"
import { AgentV2 } from "../agent"
import { PermissionAuthority } from "../permission/authority"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"

// Occurrence identity is private: it never doubles as a child Session or public schedule ID.
export const OccurrenceID = Schema.String.check(Schema.isPattern(/^schedocc_[A-Za-z0-9]{26}$/)).pipe(
  Schema.brand("SessionScheduleOccurrence.ID"),
)
export type OccurrenceID = typeof OccurrenceID.Type
export const Scheduled = Schema.Struct({ scheduleID: SessionSchedule.ID, occurrenceID: OccurrenceID })
export type Scheduled = typeof Scheduled.Type

/** Read from a claimed occurrence; these fields are not accepted from a tool/API caller. */
export type Admission = {
  readonly origin: Scheduled
  readonly revision: number
  readonly processOwner: string
  readonly parentID: SessionSchema.ID
  readonly parentCreated: string
  readonly parentAgent: AgentV2.ID
  readonly agent: AgentV2.ID
  readonly model: Model.Ref
  readonly authority: ReadonlyArray<PermissionAuthority.Snapshot>
  readonly description: string
  readonly prompt: string
  readonly taskID?: SessionSchema.ID
  readonly childID: SessionSchema.ID
  readonly launchID: string
  readonly permissionSource?: Permission.Source
}

export type Source =
  | {
      readonly type: "tool"
      readonly sessionID: SessionSchema.ID
      readonly agent: AgentV2.ID
      readonly assistantMessageID: SessionMessage.ID
      readonly toolCallID: string
    }
  | {
      readonly type: "operator"
      readonly sessionID: SessionSchema.ID
      readonly agent: AgentV2.ID
      readonly inputID: SessionMessage.ID
      readonly childCreated: string
    }
  | { readonly type: "schedule"; readonly admission: Admission }

/** Process-local launch fence supplied by the captured timer owner, never persisted as authority. */
export const Current = Context.Reference<
  { readonly occurrenceID: OccurrenceID; readonly current: () => boolean } | undefined
>("@apexo/SessionSchedule/Current", { defaultValue: () => undefined })
