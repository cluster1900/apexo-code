export * as HostHooks from "./hooks"

import path from "node:path"
import { createHash } from "node:crypto"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { parse } from "toml"
import { Global } from "./global"
import { ConfigHooks } from "./config/hooks"
import { HookEnvironment } from "./hook-environment"
import { HookPreferences } from "./hook-preferences"
import { HookProjectTrust } from "./hook-project-trust"

const identity = Symbol("hostHookIdentity")

export function name(hook: Record<string, unknown>, fallback: string) {
  const stored = Reflect.get(hook, identity)
  return typeof stored === "string" ? stored : fallback
}

export type Source = {
  readonly name: string
  readonly root: string
  readonly hooks: Record<string, unknown>
  readonly host: boolean
  readonly provenance?: "user_requirements" | "user" | "user_managed" | "file"
  // Set only by trusted Core source construction, never copied from a handler document.
  pluginID?: string
  readonly data?: string
  readonly projectAuthority?: HookProjectTrust.Authority
  policy?: "managed"
}

export function key(source: Source, event: string, group: number, handler: number, hook: Record<string, unknown>) {
  const origin = source.host
    ? ["host", name(hook, `${source.name}:${event}:${group}:${handler}`)]
    : ["plugin", source.pluginID ?? [source.root, source.name], event, group, handler]
  return `hook_${createHash("sha256")
    .update(JSON.stringify([1, ...origin]))
    .digest("hex")}`
}

export function configurable(source: Source) {
  return source.policy !== "managed" && (source.host || source.pluginID !== undefined)
}

export function blocked(source: Source, hook: Record<string, unknown>, id: string, disabled: readonly string[]) {
  return source.policy !== "managed" && (hook.enabled === false || disabled.includes(id))
}
export function runnable(event: string, hook: Record<string, unknown>) {
  return (
    ConfigHooks.Events.some((supported) => supported === event) &&
    ((hook.type === "command" && typeof hook.command === "string" && hook.command.trim().length > 0) ||
      (hook.type === "http" && typeof hook.url === "string" && hook.url.trim().length > 0))
  )
}
export function choices(
  registry: Inspection | undefined,
  event: string,
  selection?: HookPreferences.Selection,
  matcher?: string,
) {
  const selected = selection?.()
  // A retired capability is not a user preference. It must fence every source,
  // including managed policy, before a later Session can reuse this identifier.
  if (selected instanceof HookPreferences.Failure && selected.code === "conflict") return selected
  const hasUserHandlers = registry?.sources.some(
    (source) =>
      source.policy !== "managed" &&
      Array.isArray(source.hooks[event]) &&
      source.hooks[event].some(
        (group) =>
          (!matcher || typeof record(group).matcher !== "string" || matches(String(record(group).matcher), matcher)) &&
          Array.isArray(record(group).hooks) &&
          (record(group).hooks as unknown[]).some(
            (handler) => record(handler).enabled !== false && runnable(event, record(handler)),
          ),
      ),
  )
  if (!hasUserHandlers) return { disabled: [] } satisfies HookPreferences.Choices
  return (
    selection?.() ?? new HookPreferences.Failure({ code: "read", message: "Captured Hook choices are unavailable" })
  )
}

export type Inspection = { sources: Source[]; diagnostics: string[]; projectTrusted: boolean }

// Only the host-global trust store can authorize project executable configuration.
export async function discover(
  directory: string,
  home = process.env.GROK_HOME ?? path.join(Global.Path.home, ".grok"),
  userHome = Global.Path.home,
  repository?: { proof: HookProjectTrust.Proof; data: string },
): Promise<Inspection> {
  if (!path.isAbsolute(home) || !path.isAbsolute(userHome)) throw new Error("Hook homes must be absolute")
  const diagnostics: string[] = []
  const workspace = await realpath(directory)
  const legacy = await HookProjectTrust.legacy(home, workspace, repository?.proof.root)
  const saved = repository ? await HookProjectTrust.decision(repository.data, repository.proof) : undefined
  const denied = saved?.trusted === false || legacy.denied
  const exactTrusted = !denied && legacy.exact
  const repositoryTrusted = !denied && saved?.trusted === true
  const projectTrusted = exactTrusted || repositoryTrusted
  const authority = {
    workspace,
    home,
    data: repository?.data ?? Global.Path.data,
    directoryIdentity: await HookProjectTrust.directoryIdentity(workspace),
    ...(repository ? { repository: repository.proof } : {}),
    ...(saved ? { revision: saved.revision } : {}),
  }
  const paths = await readFile(path.join(home, "hooks-paths"), "utf8").catch(() => "")
  const load = async (file: string) =>
    readFile(file, "utf8")
      .then((text) => record(file.endsWith(".toml") ? parse(text) : JSON.parse(text)))
      .catch(() => {
        diagnostics.push(`${file}: unable to read or parse hook configuration`)
        return undefined
      })
  // Read settings and hooks from the same host-owned bytes. Project documents,
  // registered files and environment variables cannot enable vendor imports.
  const configPath = path.join(home, "config.toml")
  const config = (await stat(configPath).catch(() => undefined))?.isFile() ? await load(configPath) : undefined
  const imports = record(record(config?.hooks).imports)
  const vendors = (root: string, native = false) => [
    ...(imports.claude === true
      ? [path.join(root, ".claude/settings.json"), path.join(root, ".claude/settings.local.json")].map((file) => ({
          file,
          settings: true,
        }))
      : []),
    ...(native ? [{ file: path.join(root, ".grok/hooks"), settings: false }] : []),
    ...(imports.cursor === true ? [{ file: path.join(root, ".cursor/hooks.json"), settings: true }] : []),
  ]
  const project = [
    ...(repositoryTrusted && repository
      ? vendors(repository.proof.root, true).map((candidate) => ({
          ...candidate,
          projectAuthority: { ...authority, mode: "repository" as const, revision: saved!.revision },
        }))
      : []),
    ...(exactTrusted
      ? vendors(workspace, true).map((candidate) => ({
          ...candidate,
          projectAuthority: { ...authority, mode: "exact" as const },
        }))
      : []),
  ]
  const candidates: {
    file: string
    settings: boolean
    provenance: NonNullable<Source["provenance"]>
    projectAuthority?: HookProjectTrust.Authority
  }[] = [
    { file: path.join(home, "requirements.toml"), settings: true, provenance: "user_requirements" },
    { file: configPath, settings: true, provenance: "user" },
    { file: path.join(home, "managed_config.toml"), settings: true, provenance: "user_managed" },
    ...[
      ...[
        path.join(home, "hooks"),
        ...paths
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => path.isAbsolute(line)),
      ].map((file) => ({ file, settings: false })),
      ...vendors(userHome),
      ...(projectTrusted ? project : []),
    ].map((candidate) => ({ ...candidate, provenance: "file" as const })),
  ]
  const entries: {
    source: Source
    event: string
    group: Record<string, unknown>
    groupIndex: number
    hook: Record<string, unknown>
  }[] = []
  const seen = new Map<string, number>()
  const visited = new Set<string>()
  const ranks = { user_managed: 4, user_requirements: 3, user: 2, file: 1 }
  for (const candidate of candidates) {
    const info = await stat(candidate.file).catch(() => undefined)
    if (!info) continue
    if (candidate.settings && !info.isFile()) {
      diagnostics.push(`${candidate.file}: hook settings source must be a file`)
      continue
    }
    const files = info.isDirectory()
      ? (
          await readdir(candidate.file).catch(() => {
            diagnostics.push(`${candidate.file}: unable to read hook directory`)
            return []
          })
        )
          .filter((file) => file.endsWith(".json"))
          .sort()
          .map((file) => path.join(candidate.file, file))
      : [candidate.file]
    for (const file of files) {
      if (visited.has(file)) continue
      visited.add(file)
      const document = file === configPath ? config : await load(file)
      if (!document) continue
      const source = Object.freeze({
        name: file,
        root: path.dirname(file),
        hooks: {},
        host: true,
        provenance: candidate.provenance,
        ...(candidate.projectAuthority ? { projectAuthority: candidate.projectAuthority } : {}),
      })
      const hooks = ConfigHooks.normalize(
        Object.fromEntries(
          Object.entries(record(document.hooks)).filter(([event, groups]) => {
            if (event === "imports") return false
            if (Array.isArray(groups)) return true
            diagnostics.push(`${file}: invalid hook groups for ${event}`)
            return false
          }),
        ),
      )
      for (const [event, groups] of Object.entries(hooks)) {
        if (!ConfigHooks.Events.some((supported) => supported === event))
          diagnostics.push(`${file}: unsupported event ${event}`)
        if (!Array.isArray(groups)) {
          diagnostics.push(`${file}: invalid hook groups for ${event}`)
          continue
        }
        for (const [groupIndex, rawGroup] of groups.entries()) {
          const group = record(rawGroup)
          if (!Array.isArray(group.hooks)) {
            diagnostics.push(`${file}: invalid hook handlers for ${event}`)
            continue
          }
          for (const [handlerIndex, raw] of group.hooks.entries()) {
            const hook = record(raw)
            const valid =
              ((hook.type === "command" && typeof hook.command === "string") ||
                (hook.type === "http" && typeof hook.url === "string")) &&
              (group.matcher === undefined || typeof group.matcher === "string") &&
              (hook.enabled === undefined || typeof hook.enabled === "boolean") &&
              (hook.timeout == null ||
                (typeof hook.timeout === "number" && Number.isFinite(hook.timeout) && hook.timeout >= 0)) &&
              (hook.env == null ||
                (typeof hook.env === "object" &&
                  !Array.isArray(hook.env) &&
                  Object.values(hook.env).every((value) => typeof value === "string")))
            // Compare raw identity before expansion. A stronger duplicate replaces
            // the original slot but retains its own source, environment and name.
            const key = JSON.stringify([
              event,
              hook.type === "command" ? hook.command : "",
              hook.type === "http" ? hook.url : "",
              typeof group.matcher === "string" ? group.matcher : "",
            ])
            const previous = valid ? seen.get(key) : undefined
            if (
              previous !== undefined &&
              ranks[entries[previous]!.source.provenance ?? "file"] >= ranks[candidate.provenance]
            )
              continue
            const prepared = HookEnvironment.prepare(hook)
            Object.defineProperty(prepared, identity, { value: `${file}:${event}:${groupIndex}:${handlerIndex}` })
            const entry = { source, event, group, groupIndex, hook: prepared }
            if (previous !== undefined) {
              entries[previous] = entry
              continue
            }
            if (valid) seen.set(key, entries.length)
            entries.push(entry)
          }
        }
      }
    }
  }
  // Rebuild consecutive source/group runs so dispatch preserves the dedup slots.
  // Source identity is never inferred from document fields or a copied policy flag.
  const sources: Source[] = []
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const entry of entries) {
    const previous = sources.at(-1)
    const source = previous?.name === entry.source.name ? previous : { ...entry.source, hooks: {} }
    if (source !== previous) {
      sources.push(Object.freeze(source))
      groups.clear()
    }
    const groupKey = `${entry.event}:${entry.groupIndex}`
    const existing = groups.get(groupKey)
    if (existing) {
      existing.push(entry.hook)
      continue
    }
    const handlers = [entry.hook]
    groups.clear()
    groups.set(groupKey, handlers)
    const eventGroups = source.hooks[entry.event]
    const group = { ...entry.group, hooks: handlers }
    if (Array.isArray(eventGroups)) eventGroups.push(group)
    else source.hooks[entry.event] = [group]
  }
  if (
    !projectTrusted &&
    (await Promise.all(vendors(workspace, true).map((candidate) => stat(candidate.file).catch(() => undefined)))).some(
      Boolean,
    )
  )
    diagnostics.push("Project hooks are disabled until this exact workspace has a host folder-trust grant")
  return { sources, diagnostics, projectTrusted }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// Inspection deliberately excludes command text, HTTP URLs and environment values.
export async function inspect(directory: string, home?: string, userHome?: string) {
  return inspection(await discover(directory, home, userHome))
}

export function inspection(result: Inspection) {
  return {
    projectTrusted: result.projectTrusted,
    diagnostics: result.diagnostics,
    hooks: result.sources.flatMap((source) =>
      Object.entries(source.hooks).flatMap(([event, groups]) =>
        Array.isArray(groups)
          ? groups.flatMap((group, groupIndex) => {
              const item = record(group)
              return Array.isArray(item.hooks)
                ? item.hooks.map((handler, handlerIndex) => ({
                    id: key(source, event, groupIndex, handlerIndex, record(handler)),
                    configurable: configurable(source) && runnable(event, record(handler)),
                    configuredEnabled: record(handler).enabled !== false,
                    ...(source.policy === "managed"
                      ? { readOnlyReason: "managed" as const }
                      : !configurable(source)
                        ? { readOnlyReason: "unknown_source" as const }
                        : !runnable(event, record(handler))
                          ? { readOnlyReason: "unsupported" as const }
                          : {}),
                    name: name(record(handler), `${source.name}:${event}:${groupIndex}:${handlerIndex}`),
                    event,
                    source: source.name,
                    type: typeof record(handler).type === "string" ? String(record(handler).type) : "unknown",
                    matcher: typeof item.matcher === "string" ? item.matcher : undefined,
                    supported: runnable(event, record(handler)),
                  }))
                : []
            })
          : [],
      ),
    ),
  }
}

const aliases: Record<string, string[]> = {
  Read: ["read_file", "hashline_read", "read"],
  Write: ["write", "search_replace", "hashline_edit"],
  Edit: ["search_replace", "hashline_edit", "edit"],
  MultiEdit: ["search_replace", "hashline_edit"],
  NotebookEdit: ["search_replace", "hashline_edit"],
  Bash: ["run_terminal_command", "run_terminal_cmd", "bash"],
  Grep: ["grep", "hashline_grep"],
  Glob: ["list_dir", "glob"],
  LSP: ["lsp"],
  WebSearch: ["web_search", "websearch"],
  WebFetch: ["web_fetch", "webfetch"],
  TodoWrite: ["todo_write", "todowrite"],
  AskUserQuestion: ["ask_user_question", "question"],
  TaskOutput: ["get_command_or_subagent_output", "get_terminal_command_output"],
  BashOutput: ["get_command_or_subagent_output", "get_terminal_command_output"],
  BashOutputTool: ["get_command_or_subagent_output", "get_terminal_command_output"],
  AgentOutputTool: ["get_command_or_subagent_output", "get_terminal_command_output"],
  TaskStop: ["kill_command_or_subagent", "kill_terminal_command"],
  KillShell: ["kill_command_or_subagent", "kill_terminal_command"],
  KillBash: ["kill_command_or_subagent", "kill_terminal_command"],
  Skill: ["skill"],
  ToolSearch: ["search_tool", "tool_search"],
  Agent: ["spawn_subagent", "task"],
  Task: ["spawn_subagent", "task"],
  EnterPlanMode: ["enter_plan_mode", "plan_enter"],
  ExitPlanMode: ["exit_plan_mode", "plan_exit"],
  CronCreate: ["scheduler_create"],
  CronDelete: ["scheduler_delete"],
  CronList: ["scheduler_list"],
  ListMcpResourcesTool: ["ListMcpResources", "list_mcp_resources"],
}

export function matches(pattern: string, tool: string) {
  if (!pattern || pattern === "*") return true
  if (/^[a-zA-Z0-9_|]+$/.test(pattern))
    return pattern.split("|").some((name) => name === tool || aliases[name]?.includes(tool))
  try {
    const regex = new RegExp(pattern)
    return regex.test(tool) || Object.entries(aliases).some(([name, names]) => names.includes(tool) && regex.test(name))
  } catch {
    return false
  }
}
