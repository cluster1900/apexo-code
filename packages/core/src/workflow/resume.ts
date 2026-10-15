export * as WorkflowResume from "./resume"

import { Effect } from "effect"
import { SessionChildResume } from "../session/child-resume"
import { WorkflowStore } from "./store"

export const prepare = (input: Parameters<typeof SessionChildResume.prepare>[0]) =>
  SessionChildResume.prepare(input).pipe(
    Effect.catchTag("SessionHistoryCopy.Conflict", (error) =>
      Effect.fail(new WorkflowStore.Failure({ code: "invalid", message: error.message })),
    ),
  )
