export * as ConfigHooks from "./hooks"

import { Schema } from "effect"

export const Events = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PostCompact",
  "StopFailure",
  "StopCancelled",
  "PermissionDenied",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
] as const
export const Handler = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  type: Schema.Literals(["command", "http"]),
  command: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export const Group = Schema.Struct({ matcher: Schema.optional(Schema.String), hooks: Schema.Array(Handler) })

// Canonical names and aliases accepted by the pinned event contract.
const aliases: Record<string, string> = Object.fromEntries([
  ...Events.flatMap((event) => [
    [event, event],
    [event.replace(/[A-Z]/g, (letter, index) => `${index ? "_" : ""}${letter.toLowerCase()}`), event],
    [`${event[0]!.toLowerCase()}${event.slice(1)}`, event],
  ]),
  ...["SubagentEnd", "subagent_end", "subagentEnd"].map((name) => [name, "SubagentStop"]),
  ["beforeSubmitPrompt", "UserPromptSubmit"],
  ...["beforeShellExecution", "beforeMCPExecution", "beforeReadFile"].map((name) => [name, "PreToolUse"]),
  ...["afterShellExecution", "afterMCPExecution", "afterFileEdit", "afterAgentResponse", "afterAgentThought"].map(
    (name) => [name, "PostToolUse"],
  ),
])

export function canonicalEvent(name: string) {
  return aliases[name]
}

export function normalize(hooks: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const [name, groups] of Object.entries(hooks)) {
    const event = canonicalEvent(name) ?? name
    const previous = result[event]
    result[event] =
      Array.isArray(previous) && Array.isArray(groups)
        ? [
            ...previous,
            ...(event === "SubagentStop"
              ? groups.filter((group) => !previous.some((value) => JSON.stringify(value) === JSON.stringify(group)))
              : groups),
          ]
        : groups
  }
  return result
}
