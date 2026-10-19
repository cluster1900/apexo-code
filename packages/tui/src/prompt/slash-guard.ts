import { parseSlashInput } from "@apexo/sdk/v2/grok-commands"

/**
 * Built-ins that `submitInner` still handles itself further down, with their arguments (`/goal <objective>`,
 * `/workflow <name>`, `/btw <question>`, native Memory). The guard must leave them alone.
 */
const downstream = ["goal", "workflow", "deep-research", "btw"]
const nativeDownstream = ["memory", "remember", "flush", "dream"]
// Bare `/feedback` and `/hooks` open their dialogs there (creating a session from the home screen).
const bareDownstream = ["feedback", "hooks"]

/**
 * Session-route built-ins, which are only registered while a session is open. Typed from the home screen they would
 * otherwise reach the model as a first prompt.
 */
const sessionOnly = [
  "workflows",
  "feedback",
  "hooks",
  "mem",
  "plugins",
  "marketplace",
  "tasks",
  "rename",
  "title",
  "timeline",
  "fork",
  "compact",
  "summarize",
  "undo",
  "rewind",
  "redo",
  "timestamps",
  "toggle-timestamps",
  "thinking",
  "toggle-thinking",
  "export",
  "usage",
  "cost",
  "trace",
]

/**
 * What to do with a slash command the argument handlers did not take: a built-in palette command typed by name or
 * alias (with arguments or a trailing space) runs locally instead of going to the model, and a session-only built-in
 * typed without a session gets a notice. Server commands (config commands, MCP prompts, skills) keep their route.
 */
export function builtinSlashTarget<T extends { display: string; aliases?: string[] }>(input: {
  text: string
  slashes: readonly T[]
  serverCommands: readonly { name: string }[]
  native: boolean
  session: boolean
}): { type: "run"; entry: T; name: string; args: string } | { type: "session-only"; name: string } | undefined {
  const parsed = parseSlashInput(input.text)
  if (!parsed) return
  if (input.serverCommands.some((command) => command.name === parsed.name)) return
  if (downstream.includes(parsed.name) || (input.native && nativeDownstream.includes(parsed.name))) return
  if (!parsed.args && bareDownstream.includes(parsed.name)) return
  const slash = `/${parsed.name}`
  const entry = input.slashes.find((item) => item.display === slash || item.aliases?.includes(slash))
  if (entry) return { type: "run", entry, name: parsed.name, args: parsed.args }
  if (!input.session && sessionOnly.includes(parsed.name)) return { type: "session-only", name: parsed.name }
}
