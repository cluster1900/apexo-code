export * as ClaudeImport from "./claude-import"

// Grok Build `/import-claude`: bring ~/.claude settings (permissions, env, MCP servers, hooks, rule paths) into apexo.
// The plan is pure so the CLI, Desktop and tests share one translation; `apply` writes the global config and hooks file.
import path from "path"
import fs from "fs/promises"
import { Schema } from "effect"

export const SectionID = Schema.Literals(["permissions", "env", "mcp", "hooks", "paths"])
export type SectionID = typeof SectionID.Type

export const Section = Schema.Struct({
  id: SectionID,
  count: Schema.Number,
  items: Schema.Array(Schema.String),
})
export const Preview = Schema.Struct({
  found: Schema.Boolean,
  sources: Schema.Array(Schema.String),
  sections: Schema.Array(Section),
  skipped: Schema.Array(Schema.String),
})
export type Preview = typeof Preview.Type
export const ApplyInput = Schema.Struct({ sections: Schema.Array(SectionID) })
export const ApplyResult = Schema.Struct({
  applied: Schema.Array(Section),
  skipped: Schema.Array(Schema.String),
  hooksFile: Schema.optional(Schema.String),
})
export type ApplyResult = typeof ApplyResult.Type

type Action = "allow" | "ask" | "deny"
type Rules = Record<string, Record<string, Action>>
export type Plan = {
  sources: string[]
  skipped: string[]
  permission: Rules
  permissionMode?: "ask" | "auto" | "always-approve"
  env: Record<string, string>
  mcp: Record<string, Record<string, unknown>>
  hooks: Record<string, unknown[]>
  instructions: string[]
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : [])

const tools: Record<string, string> = {
  Bash: "bash",
  Read: "read",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Grep: "grep",
  Glob: "glob",
  LS: "list",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  TodoWrite: "todowrite",
  Task: "task",
}

/** Translate one Claude permission rule (`Bash(git *)`, `Read`, `mcp__linear__*`) into an apexo tool + pattern. */
export function translateRule(rule: string): { tool: string; pattern: string } | { skip: string } {
  const text = rule.trim()
  const mcp = text.match(/^mcp__([^_]+(?:_[^_]+)*?)(?:__(.+))?$/)
  if (mcp) return { tool: `${mcp[1]}_${mcp[2] ?? "*"}`, pattern: "*" }
  const match = text.match(/^([A-Za-z]+)(?:\((.*)\))?$/)
  if (!match) return { skip: `${rule}: unrecognized rule` }
  const tool = tools[match[1]]
  if (!tool) return { skip: `${rule}: unrecognized tool` }
  const argument = match[2]?.trim()
  if (!argument) return { tool, pattern: "*" }
  if (/^[a-z_]+:/.test(argument) && !argument.includes(" "))
    return { skip: `${rule}: parameter rules are not supported` }
  // Claude writes prefix rules as `git:*`; apexo patterns are globs.
  return { tool, pattern: argument.replace(/:\*$/, " *") }
}

const modes: Record<string, Plan["permissionMode"] | "acceptEdits"> = {
  default: "ask",
  auto: "auto",
  bypassPermissions: "always-approve",
  acceptEdits: "acceptEdits",
}

export function plan(input: {
  settings: { file: string; data: unknown }[]
  claudeJson?: { file: string; data: unknown }
  rules?: { dir: string; files: string[] }
}): Plan {
  const result: Plan = { sources: [], skipped: [], permission: {}, env: {}, mcp: {}, hooks: {}, instructions: [] }
  const allow: string[] = []
  const ask: string[] = []
  const deny: string[] = []
  for (const { file, data } of input.settings) {
    result.sources.push(file)
    const settings = record(data)
    const permissions = record(settings.permissions)
    allow.push(...strings(permissions.allow))
    ask.push(...strings(permissions.ask))
    deny.push(...strings(permissions.deny))
    const mode = (permissions.defaultMode ?? settings.defaultMode) as string | undefined
    if (typeof mode === "string") {
      const mapped = modes[mode]
      if (mapped === "acceptEdits") allow.push("Edit")
      else if (mapped) result.permissionMode = mapped
      else result.skipped.push(`defaultMode ${mode}: not supported`)
    }
    if (strings(permissions.additionalDirectories).length)
      result.skipped.push(`${file}: permissions.additionalDirectories is not supported`)
    for (const [key, value] of Object.entries(record(settings.env)))
      if (typeof value === "string") result.env[key] = value
    for (const [event, groups] of Object.entries(record(settings.hooks)))
      if (Array.isArray(groups)) result.hooks[event] = [...(result.hooks[event] ?? []), ...groups]
    for (const [name, server] of Object.entries(record(settings.mcpServers))) addMcp(result, name, server)
  }
  if (input.claudeJson) {
    result.sources.push(input.claudeJson.file)
    for (const [name, server] of Object.entries(record(record(input.claudeJson.data).mcpServers)))
      addMcp(result, name, server)
  }
  // Insertion order allow → ask → deny: apexo applies the last matching rule, so deny wins like Grok and Claude.
  for (const [action, rules] of [
    ["allow", allow],
    ["ask", ask],
    ["deny", deny],
  ] as const) {
    for (const rule of rules) {
      const translated = translateRule(rule)
      if ("skip" in translated) {
        result.skipped.push(translated.skip)
        continue
      }
      const entry = (result.permission[translated.tool] ??= {})
      delete entry[translated.pattern]
      entry[translated.pattern] = action
    }
  }
  if (input.rules?.files.length) {
    result.sources.push(input.rules.dir)
    result.instructions.push(path.join(input.rules.dir, "*.md"))
  }
  return result
}

function addMcp(result: Plan, name: string, value: unknown) {
  const server = record(value)
  if (typeof server.url === "string") {
    result.mcp[name] = {
      type: "remote",
      url: server.url,
      ...(Object.keys(record(server.headers)).length ? { headers: record(server.headers) } : {}),
    }
    return
  }
  if (typeof server.command !== "string") return result.skipped.push(`mcp ${name}: no command or url`)
  result.mcp[name] = {
    type: "local",
    command: [server.command, ...strings(server.args)],
    ...(Object.keys(record(server.env)).length ? { environment: record(server.env) } : {}),
  }
}

export function sections(input: Plan) {
  const permissionItems = Object.entries(input.permission).flatMap(([tool, rules]) =>
    Object.entries(rules).map(([pattern, action]) => `${action} ${tool}${pattern === "*" ? "" : ` ${pattern}`}`),
  )
  if (input.permissionMode) permissionItems.push(`permission mode ${input.permissionMode}`)
  const hookItems = Object.entries(input.hooks).map(([event, groups]) => `${event} (${groups.length})`)
  const all: { id: SectionID; items: string[] }[] = [
    { id: "permissions", items: permissionItems },
    { id: "env", items: Object.keys(input.env) },
    { id: "mcp", items: Object.keys(input.mcp) },
    { id: "hooks", items: hookItems },
    { id: "paths", items: input.instructions },
  ]
  return all.map((section) => ({ ...section, count: section.items.length }))
}

/** apexo config patch for the chosen sections. */
export function configPatch(input: Plan, chosen: readonly SectionID[]) {
  const patch: Record<string, unknown> = {}
  if (chosen.includes("permissions")) {
    if (Object.keys(input.permission).length) patch.permission = input.permission
    if (input.permissionMode) patch.ui = { permission_mode: input.permissionMode }
  }
  if (chosen.includes("env") && Object.keys(input.env).length) patch.env = input.env
  if (chosen.includes("mcp") && Object.keys(input.mcp).length) patch.mcp = input.mcp
  if (chosen.includes("paths") && input.instructions.length) patch.instructions = input.instructions
  return patch
}

const readJson = async (file: string) => {
  const text = await fs.readFile(file, "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return { file, data: JSON.parse(text) as unknown }
  } catch {
    return { file, data: {}, invalid: true }
  }
}

export async function load(home: string) {
  const claude = path.join(home, ".claude")
  const settings = (
    await Promise.all(["settings.json", "settings.local.json"].map((name) => readJson(path.join(claude, name))))
  ).filter((item) => item !== undefined)
  const claudeJson = await readJson(path.join(home, ".claude.json"))
  const rulesDir = path.join(claude, "rules")
  const files = (await fs.readdir(rulesDir).catch(() => [] as string[])).filter((file) => file.endsWith(".md"))
  const result = plan({ settings, claudeJson, rules: { dir: rulesDir, files } })
  for (const item of [...settings, ...(claudeJson ? [claudeJson] : [])])
    if ("invalid" in item) result.skipped.push(`${item.file}: invalid JSON`)
  return result
}

export function preview(input: Plan): Preview {
  return {
    found: input.sources.length > 0,
    sources: input.sources,
    sections: sections(input),
    skipped: input.skipped,
  }
}

/** Grok-native hooks directory (`$GROK_HOME/hooks`, default ~/.grok/hooks), loaded by the hook host. */
export function hooksFile(home: string) {
  return path.join(process.env.GROK_HOME ?? path.join(home, ".grok"), "hooks", "claude-import.json")
}

export async function writeHooks(home: string, input: Plan) {
  if (!Object.keys(input.hooks).length) return undefined
  const file = hooksFile(home)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ hooks: input.hooks }, null, 2) + "\n")
  return file
}
