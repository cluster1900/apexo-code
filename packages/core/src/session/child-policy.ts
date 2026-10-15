export * as SessionChildPolicy from "./child-policy"

import { Schema } from "effect"

export const Policy = Schema.Struct({
  workflow: Schema.Boolean,
  readOnly: Schema.Boolean,
  taskPolicy: Schema.Boolean,
})
export type Policy = typeof Policy.Type
const readOnly = new Set(["read", "glob", "grep", "list", "webfetch", "websearch"])
const workflowExcluded = new Set(["workflow", "task", "task_output", "task_wait", "task_cancel", "update_goal"])

/** A copied transcript cannot lift the source's tool capability ceiling. */
export function allows(policy: Policy, name: string) {
  return (
    (!policy.taskPolicy || !name.startsWith("scheduler_")) &&
    (!policy.workflow || !workflowExcluded.has(name)) &&
    (!policy.readOnly || readOnly.has(name))
  )
}
