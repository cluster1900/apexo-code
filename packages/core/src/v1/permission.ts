export * as PermissionV1 from "./permission"

import { Schema } from "effect"
export * from "@apexo/schema/permission-v1"
import { ID } from "@apexo/schema/permission-v1"

const GrokBuildPermissionAliases = {
  run_terminal_command: "bash",
  read_file: "read",
  list_dir: "list",
  search_replace: "edit",
  spawn_subagent: "task",
  todo_write: "todowrite",
  ask_user_question: "question",
  web_fetch: "webfetch",
  web_search: "websearch",
} as const

export function canonicalPermission(permission: string): string {
  return GrokBuildPermissionAliases[permission as keyof typeof GrokBuildPermissionAliases] ?? permission
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError
