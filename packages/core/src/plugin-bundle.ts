export * as PluginBundle from "./plugin-bundle"

import fs from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { PluginStore } from "./plugin-store"
import { ConfigMarkdown } from "./config/markdown"
import { ConfigV1 } from "./v1/config/config"
import { ConfigMCPV1 } from "./v1/config/mcp"
import { ConfigLSPV1 } from "./v1/config/lsp"

export class Unsupported extends Schema.TaggedErrorClass<Unsupported>()("PluginBundle.Unsupported", {
  message: Schema.String,
  components: Schema.Array(Schema.Literals(["mcp", "lsp"])),
}) {}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}
function list(value: unknown) {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

export async function read(root: string, namespace?: string, options?: { native?: boolean; data?: string }) {
  const substitute = (value: string, directory: string) => expand(value, directory, options?.data)
  const inspected = await PluginStore.inspect(root, namespace)
  const name = namespace ?? inspected.name
  const config: ConfigV1.Info = { command: {}, agent: {}, mcp: {}, lsp: {} }
  const skills: { name: string; description?: string; location: string; content: string }[] = []
  for (const kind of ["skills", "commands", "agents"] as const) {
    const override = inspected.manifest[kind]
    const paths = typeof override === "string" ? [override] : list(override)
    const roots = paths.length
      ? await Promise.all(paths.map((p) => PluginStore.contained(root, p)))
      : [path.join(root, kind)]
    for (const file of inspected.files.filter(
      (f) =>
        roots.some((r) => f === r || f.startsWith(`${r}${path.sep}`)) &&
        (kind === "skills" ? path.basename(f) === "SKILL.md" : f.endsWith(".md")),
    )) {
      const md = ConfigMarkdown.parse(await fs.readFile(file, "utf8"))
      const data: Record<string, unknown> = md.data
      const id = `${name}:${text(data.name) ?? path.basename(kind === "skills" ? path.dirname(file) : file, ".md")}`
      const content = substitute(md.content, root)
      if (kind === "skills") {
        skills.push({ name: id, description: text(data.description), content, location: file })
        continue
      }
      if (kind === "commands") {
        config.command![id] = { description: text(data.description), template: content }
        continue
      }
      // A plugin agent never raises host permissions or selects an unconfigured model.
      config.agent![id] = { description: text(data.description), prompt: content, mode: "subagent" }
    }
  }
  const mcp = await component(root, inspected.manifest.mcpServers, ".mcp.json", "mcpServers")
  for (const [key, value] of Object.entries(mcp)) {
    const item = record(value)
    const env = Object.fromEntries(
      Object.entries(record(item.env)).map(([key, value]) => [key, substitute(String(value), root)]),
    )
    const command = text(item.command)
    const url = text(item.url)
    if (command) {
      config.mcp![`${name}:${key}`] = Schema.decodeUnknownSync(ConfigMCPV1.Info)({
        type: "local",
        command: [substitute(command, root), ...list(item.args).map((v) => substitute(v, root))],
        cwd: root,
        environment: env,
      })
      continue
    }
    if (url) {
      config.mcp![`${name}:${key}`] = Schema.decodeUnknownSync(ConfigMCPV1.Info)({
        type: "remote",
        url: substitute(url, root),
        headers: Object.fromEntries(
          Object.entries(record(item.headers)).map(([key, value]) => [key, substitute(String(value), root)]),
        ),
      })
      continue
    }
    throw new PluginStore.Error("invalid", `Invalid MCP server ${key}`)
  }
  const lsp = await component(root, inspected.manifest.lspServers, ".lsp.json", "lspServers")
  for (const [key, value] of Object.entries(lsp)) {
    const item = record(value)
    const command = text(item.command)
    if (!command) throw new PluginStore.Error("invalid", `Invalid language server ${key}`)
    if (options?.native) {
      for (const aliases of [
        ["restartOnCrash", "restart_on_crash"],
        ["maxRestarts", "max_restarts"],
        ["shutdownTimeout", "shutdown_timeout"],
        ["workspaceFolder", "workspace_folder"],
        ["workspaceOpen", "workspace_open"],
      ])
        if (aliases.every((field) => Object.hasOwn(item, field)))
          throw new PluginStore.Error("invalid", `Duplicate language-server policy aliases: ${aliases.join(" / ")}`)
    }
    if (options?.native && item.transport !== undefined && item.transport !== "stdio" && item.transport !== "socket")
      throw new Unsupported({
        message: "Unsupported native plugin language-server transport",
        components: ["lsp"],
      })
    const workspaceFolder = Object.hasOwn(item, "workspaceFolder") ? item.workspaceFolder : item.workspace_folder
    const workspaceOpen = Object.hasOwn(item, "workspaceOpen") ? item.workspaceOpen : item.workspace_open
    if (typeof config.lsp === "object")
      config.lsp[`${name}:${key}`] = Schema.decodeUnknownSync(ConfigLSPV1.Entry)({
        command: [
          item.transport !== "socket" && command.startsWith(".")
            ? path.resolve(root, substitute(command, root))
            : substitute(command, root),
          ...list(item.args).map((v) => substitute(v, root)),
        ],
        ...(options?.native && item.transport !== undefined ? { transport: item.transport } : {}),
        extensions: Object.keys(record(item.extensionToLanguage ?? item.extensionToLanguageId ?? item.extensions)),
        languageIds: record(item.extensionToLanguage ?? item.extensionToLanguageId ?? item.extensions),
        env: Object.fromEntries(
          Object.entries(record(item.env)).map(([key, value]) => [key, substitute(String(value), root)]),
        ),
        initialization: item.initializationOptions ?? item.initialization_options,
        settings: item.settings,
        ...(options?.native && workspaceFolder !== undefined
          ? {
              workspaceFolder:
                typeof workspaceFolder === "string" ? substitute(workspaceFolder, root) : workspaceFolder,
            }
          : {}),
        ...(options?.native && workspaceOpen !== undefined
          ? {
              workspaceOpen:
                workspaceOpen && typeof workspaceOpen === "object" && !Array.isArray(workspaceOpen)
                  ? {
                      ...workspaceOpen,
                      ...(typeof record(workspaceOpen).solution === "string"
                        ? { solution: substitute(String(record(workspaceOpen).solution), root) }
                        : {}),
                      ...(Array.isArray(record(workspaceOpen).projects)
                        ? {
                            projects: (record(workspaceOpen).projects as unknown[]).map((value) =>
                              typeof value === "string" ? substitute(value, root) : value,
                            ),
                          }
                        : {}),
                    }
                  : workspaceOpen,
            }
          : {}),
        restartOnCrash: options?.native ? (item.restartOnCrash ?? item.restart_on_crash) : undefined,
        maxRestarts: options?.native ? (item.maxRestarts ?? item.max_restarts) : undefined,
        timeout: {
          startup: item.startupTimeout ?? item.startup_timeout,
          shutdown: options?.native ? (item.shutdownTimeout ?? item.shutdown_timeout) : undefined,
          request: item.requestTimeout ?? item.request_timeout,
        },
      })
  }
  return { config, skills, hooks: await component(root, inspected.manifest.hooks, "hooks/hooks.json", "hooks") }
}

export async function configuration(store: string) {
  const entries = await PluginStore.active(store)
  const bundles = await Promise.all(entries.map((entry) => read(entry.root, entry.item.name)))
  return bundles.reduce<ConfigV1.Info>(
    (out, bundle) => ({
      ...out,
      command: { ...out.command, ...bundle.config.command },
      agent: { ...out.agent, ...bundle.config.agent },
      mcp: { ...out.mcp, ...bundle.config.mcp },
      lsp: {
        ...(typeof out.lsp === "object" ? out.lsp : {}),
        ...(typeof bundle.config.lsp === "object" ? bundle.config.lsp : {}),
      },
    }),
    {},
  )
}

async function component(root: string, declared: unknown, fallback: string, key: string) {
  if (declared && typeof declared === "object" && !Array.isArray(declared))
    return record(record(declared)[key] ?? declared)
  const file = typeof declared === "string" ? await PluginStore.contained(root, declared) : path.join(root, fallback)
  const raw = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  const data = record(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(raw))
  return record(data[key] ?? data)
}

function expand(value: string, root: string, data?: string) {
  const expanded = data
    ? value.replaceAll("${GROK_PLUGIN_DATA}", data).replaceAll("${CLAUDE_PLUGIN_DATA}", data)
    : value
  return expanded
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", root)
    .replaceAll("${GROK_PLUGIN_ROOT}", root)
    .replaceAll("${PLUGIN_ROOT}", root)
}
