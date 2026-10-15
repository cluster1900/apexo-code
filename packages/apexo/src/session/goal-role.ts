import { Context, type Effect } from "effect"
import type { SessionGoalReview } from "@apexo/core/session/goal-review"
import type { PermissionV1 } from "@apexo/core/v1/permission"

/** Internal execution context, never accepted from a prompt's public JSON body. */
export const Current = Context.Reference<
  | (SessionGoalReview.Request & {
      parentPermission: PermissionV1.Ruleset
      reports?: { paths: string[]; write: (target: string, content: string) => Effect.Effect<void, unknown> }
    })
  | undefined
>("@apexo/SessionGoalRole", {
  defaultValue: () => undefined,
})

export const tools = new Set([
  "read",
  "read_file",
  "glob",
  "grep",
  "list",
  "list_dir",
  "lsp",
  "bash",
  "shell",
  "run_terminal_cmd",
  "get_task_output",
  "wait_tasks",
  "kill_task",
  "webfetch",
  "websearch",
  "web_fetch",
  "web_search",
])

export * as SessionGoalRole from "./goal-role"
