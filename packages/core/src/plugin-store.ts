export * as PluginStore from "./plugin-store"

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parse } from "toml"
import { Schema } from "effect"
import { PluginStore } from "@apexo/schema/plugin-store"
import { Flock } from "./util/flock"
import { ConfigMarkdown } from "./config/markdown"

const exec = promisify(execFile)
const official = "https://github.com/xai-org/plugin-marketplace.git"
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/
const kinds = ["skills", "commands", "agents", "mcpServers", "lspServers", "hooks"] as const
const Location = Schema.Struct({
  location: Schema.String,
  ref: Schema.optional(Schema.String),
  subdir: Schema.optional(Schema.String),
})
const Entry = Schema.Struct({ item: PluginStore.Item, target: Location })
const Installed = Schema.Struct({
  item: PluginStore.Item,
  target: Location,
  root: Schema.String,
  trusted: Schema.Boolean,
})
const Source = Schema.Struct({
  info: PluginStore.Source,
  target: Schema.optional(Location),
  root: Schema.optional(Schema.String),
  entries: Schema.Array(Entry),
})
const Data = Schema.Struct({
  id: Schema.String,
  epoch: Schema.String,
  device: Schema.String,
  inode: Schema.String,
  retired: Schema.Boolean,
  readers: Schema.Array(Schema.Struct({ token: Schema.String, pid: Schema.Number, host: Schema.String })),
})
const State = Schema.Struct({
  sources: Schema.Array(Source),
  installed: Schema.Array(Installed),
  data: Schema.optional(Schema.Array(Data)),
})
type State = typeof State.Type
type Entry = typeof Entry.Type

export class Error extends globalThis.Error {
  constructor(
    readonly code: "invalid" | "trust" | "missing" | "failed",
    message: string,
  ) {
    super(message)
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20)
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function string(value: unknown) {
  return typeof value === "string" ? value : undefined
}
function cleanBranding(value: string) {
  return value
    .replace(/\bfor Grok Build\b/gi, "for Apexo")
    .replace(/\bdirectly from Grok\b/gi, "directly from Apexo")
    .replace(/\bGrok Build Official Plugins\b/gi, "Official Plugins")
    .replace(/\bGrok Build\b/g, "Apexo")
    .replace(/^xai-official$/i, "official")
    .replace(/^xAI$/i, "Official")
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}
async function json(file: string): Promise<unknown> {
  const size = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!size) return undefined
  if (size.size > 8_000_000) throw new Error("invalid", "Plugin metadata is too large")
  const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined) return undefined
  if (text.length > 8_000_000) throw new Error("invalid", "Plugin metadata is too large")
  return Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(text)
}
async function state(root: string): Promise<State> {
  const value = await json(path.join(root, "registry.json"))
  if (value !== undefined) return Schema.decodeUnknownSync(State)(value)
  return {
    sources: [{ info: { id: hash(official), name: "xAI", location: official, official: true }, entries: [] }],
    installed: [],
  }
}
async function save(root: string, value: State) {
  const file = path.join(root, `${randomUUID()}.json`)
  await fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 })
  await fs.rename(file, path.join(root, "registry.json"))
}

export async function catalog(root: string): Promise<PluginStore.Catalog> {
  const value = await state(root)
  const installed = new Map(value.installed.map((v) => [v.item.id, v]))
  const entries = value.sources.flatMap((source) =>
    source.entries.map((entry) => {
      const current = installed.get(entry.item.id)
      installed.delete(entry.item.id)
      const base = { ...entry.item, description: cleanBranding(entry.item.description) }
      return current
        ? {
            ...base,
            status: current.item.status,
            path: current.root,
            installedVersion: current.item.version,
            installedRevision: current.item.revision,
            components: current.item.components,
            warnings: current.item.warnings,
          }
        : base
    }),
  )
  return {
    sources: value.sources.map((source) => ({ ...source.info, name: cleanBranding(source.info.name) })),
    ...(value.data?.some((entry) => entry.retired)
      ? {
          retainedData: value.data
            .filter((entry) => entry.retired)
            .map((entry) => ({
              id: entry.id,
              reason: entry.readers.length ? ("readers" as const) : ("ownership" as const),
            })),
        }
      : {}),
    items: [
      ...entries,
      ...[...installed.values()].map((v) => ({
        ...v.item,
        description: cleanBranding(v.item.description),
        path: v.root,
      })),
    ],
  }
}

export async function detail(root: string, id: string) {
  const value = await state(root)
  const items = (await catalog(root)).items
  // Like mutations (and Grok Build's `plugin details <name>`), accept a plain name when it is unambiguous,
  // preferring installed plugins over catalog entries with the same name.
  const named = (list: typeof items) => list.filter((v) => v.name === id)
  const candidates = items.some((v) => v.id === id)
    ? items.filter((v) => v.id === id)
    : named(items.filter((v) => v.status !== "available")).length
      ? named(items.filter((v) => v.status !== "available"))
      : named(items)
  if (candidates.length > 1) throw new Error("invalid", "Multiple plugins have this name. Use the full plugin ID.")
  const item = candidates[0]
  if (!item) throw new Error("missing", "Plugin not found")
  const installed = value.installed.find((v) => v.item.id === item.id)
  const entry = value.sources.flatMap((s) => s.entries).find((e) => e.item.id === item.id)
  const directory =
    installed?.root ?? (entry && path.isAbsolute(entry.target.location) ? entry.target.location : undefined)
  const readme = directory ? await fs.readFile(path.join(directory, "README.md"), "utf8").catch(() => "") : ""
  return { item, readme: readme.slice(0, 100_000) }
}

type Policy = {
  readonly requireSha: boolean
  readonly strictMarketplaces: boolean
  readonly allowedMarketplaces: ReadonlySet<string>
  readonly disableAllPlugins: boolean
  readonly disabledPlugins: ReadonlySet<string>
}

async function normalizePolicyLocation(raw: string): Promise<string | undefined> {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    return (await resolveSource(trimmed)).location
  } catch {
    if (path.isAbsolute(trimmed)) return path.resolve(trimmed)
    return trimmed
  }
}

async function extractMarketplaceList(value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const entry of value) {
    const raw =
      typeof entry === "string"
        ? entry
        : (string(record(entry).location) ?? string(record(entry).url) ?? string(record(entry).source))
    if (!raw) continue
    const normalized = await normalizePolicyLocation(raw)
    if (normalized) items.push(normalized)
  }
  return items
}

async function loadPolicy(root: string): Promise<Policy> {
  const dirs = [process.env.GROK_SYSTEM_CONFIG_DIR, process.env.GROK_HOME, root].filter(
    (d): d is string => typeof d === "string" && d.length > 0 && path.isAbsolute(d),
  )
  const files = dirs.flatMap((dir) => [
    path.join(dir, "requirements.toml"),
    path.join(dir, "config.toml"),
    path.join(dir, "managed_config.toml"),
    path.join(dir, "policy.toml"),
  ])
  const allowedMarketplaces = new Set<string>([official])
  const disabledPlugins = new Set<string>()
  const state = {
    requireSha: process.env.GROK_MARKETPLACE_REQUIRE_SHA === "1" || process.env.GROK_MARKETPLACE_REQUIRE_SHA === "true",
    strictMarketplaces: false,
    disableAllPlugins: false,
  }
  const visited = new Set<string>()
  for (const file of files) {
    if (visited.has(file)) continue
    visited.add(file)
    const text = await fs.readFile(file, "utf8").catch(() => undefined)
    if (!text) continue
    const doc = (() => {
      try {
        return record(parse(text))
      } catch {
        return undefined
      }
    })()
    if (!doc) continue
    const pluginsSection = record(doc.plugins)
    const marketplaceSection = record(doc.marketplace)
    if (
      doc.require_sha === true ||
      doc.requireSha === true ||
      pluginsSection.require_sha === true ||
      pluginsSection.requireSha === true ||
      marketplaceSection.require_sha === true ||
      marketplaceSection.requireSha === true
    ) {
      state.requireSha = true
    }
    const strictRaw =
      doc.strict_known_marketplaces ??
      doc.strictKnownMarketplaces ??
      pluginsSection.strict_known_marketplaces ??
      pluginsSection.strictKnownMarketplaces ??
      marketplaceSection.strict_known_marketplaces ??
      marketplaceSection.strictKnownMarketplaces
    if (strictRaw === true) {
      state.strictMarketplaces = true
    } else if (Array.isArray(strictRaw)) {
      state.strictMarketplaces = true
      for (const loc of await extractMarketplaceList(strictRaw)) allowedMarketplaces.add(loc)
    }
    const extraRaw =
      doc.extra_known_marketplaces ??
      doc.extraKnownMarketplaces ??
      pluginsSection.extra_known_marketplaces ??
      pluginsSection.extraKnownMarketplaces ??
      marketplaceSection.extra_known_marketplaces ??
      marketplaceSection.extraKnownMarketplaces
    for (const loc of await extractMarketplaceList(extraRaw)) allowedMarketplaces.add(loc)

    if (
      doc.disable_plugins === true ||
      doc.disablePlugins === true ||
      pluginsSection.disable_plugins === true ||
      pluginsSection.disablePlugins === true ||
      pluginsSection.disable_all === true
    ) {
      state.disableAllPlugins = true
    }
    for (const list of [
      doc.disable_plugins,
      doc.disablePlugins,
      doc.disabled_plugins,
      doc.disabledPlugins,
      pluginsSection.disabled,
      pluginsSection.disable_plugins,
      pluginsSection.disablePlugins,
      pluginsSection.disabled_plugins,
      pluginsSection.disabledPlugins,
    ]) {
      for (const name of strings(list)) disabledPlugins.add(name)
    }
  }
  return {
    requireSha: state.requireSha,
    strictMarketplaces: state.strictMarketplaces,
    allowedMarketplaces,
    disableAllPlugins: state.disableAllPlugins,
    disabledPlugins,
  }
}

function isPluginDisabledByPolicy(policy: Policy, id: string, name: string) {
  return policy.disableAllPlugins || policy.disabledPlugins.has(id) || policy.disabledPlugins.has(name)
}

function isMarketplaceAllowed(policy: Policy, location: string) {
  if (!policy.strictMarketplaces) return true
  if (policy.allowedMarketplaces.has(location)) return true
  for (const allowed of policy.allowedMarketplaces) {
    if (path.isAbsolute(allowed) && path.isAbsolute(location) && location.startsWith(`${allowed}${path.sep}`)) {
      return true
    }
  }
  return false
}

// Runtime consumers only see explicitly installed, enabled, and policy-permitted snapshots.
export async function active(root: string) {
  const [value, policy] = await Promise.all([state(root), loadPolicy(root)])
  return value.installed.filter(
    (entry) => entry.item.status === "enabled" && !isPluginDisabledByPolicy(policy, entry.item.id, entry.item.name),
  )
}

/** Capture all enabled, trusted snapshots and their data under the registry mutation lock. */
export async function capture(root: string) {
  await fs.mkdir(root, { recursive: true })
  root = await fs.realpath(root)
  await using lock = await Flock.acquire(`plugins:${root}`)
  const [value, policy] = await Promise.all([state(root), loadPolicy(root)])
  const entries = value.installed.filter(
    (entry) => entry.item.status === "enabled" && !isPluginDisabledByPolicy(policy, entry.item.id, entry.item.name),
  )
  if (entries.some((entry) => !entry.trusted)) throw new Error("trust", "Enabled plugin is not trusted")
  const records = [...(await cleanData(root, value.data ?? []))]
  const token = randomUUID()
  const plugins = []
  for (const plugin of entries) {
    const existing = records.find((entry) => entry.id === plugin.item.id && !entry.retired)
    const epoch = existing?.epoch ?? randomUUID()
    const directory = dataPath(root, plugin.item.id, epoch)
    await safeDataParent(root)
    if (!existing) await fs.mkdir(directory, { mode: 0o700 })
    const info = await fs.lstat(directory, { bigint: true })
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (existing && (existing.device !== String(info.dev) || existing.inode !== String(info.ino)))
    )
      throw new Error("invalid", "Plugin data ownership changed")
    const record = {
      id: plugin.item.id,
      epoch,
      device: String(info.dev),
      inode: String(info.ino),
      retired: false,
      readers: [...(existing?.readers ?? []), { token, pid: process.pid, host: os.hostname() }],
    }
    if (existing) records.splice(records.indexOf(existing), 1, record)
    else records.push(record)
    plugins.push({ ...plugin, data: directory })
  }
  await save(root, { ...value, data: records })
  const ownedRoot = root
  return {
    plugins,
    // Release only after every captured consumer has joined. Dead coordinator PIDs
    // alone cannot prove that orphaned plugin child processes stopped using data.
    release: async () => {
      await using lock = await Flock.acquire(`plugins:${ownedRoot}`)
      const current = await state(ownedRoot)
      const released = (current.data ?? []).map((entry) => ({
        ...entry,
        readers: entry.readers.filter((reader) => reader.token !== token),
      }))
      await save(ownedRoot, { ...current, data: released })
      await save(ownedRoot, { ...current, data: await cleanData(ownedRoot, released) })
    },
  }
}

function dataPath(root: string, id: string, epoch: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(epoch))
    throw new Error("invalid", "Invalid plugin data epoch")
  return path.join(root, "data", `${createHash("sha256").update(id).digest("hex")}-${epoch}`)
}

async function safeDataParent(root: string) {
  const directory = path.join(root, "data")
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await fs.lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || (await fs.realpath(directory)) !== directory)
    throw new Error("invalid", "Plugin data parent ownership changed")
}

async function cleanData(root: string, records: readonly (typeof Data.Type)[]) {
  const retained = []
  for (const entry of records) {
    if (!entry.retired || entry.readers.length) {
      retained.push(entry)
      continue
    }
    await safeDataParent(root)
    const directory = dataPath(root, entry.id, entry.epoch)
    const info = await fs.lstat(directory, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!info) continue
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      String(info.dev) !== entry.device ||
      String(info.ino) !== entry.inode
    ) {
      retained.push(entry)
      continue
    }
    await fs.rm(directory, { recursive: true })
  }
  return retained
}

export async function mutate(root: string, input: PluginStore.Action) {
  await fs.mkdir(root, { recursive: true })
  root = await fs.realpath(root)
  await using lock = await Flock.acquire(`plugins:${root}`)
  const [value, policy] = await Promise.all([state(root), loadPolicy(root)])
  if (input.keepData !== undefined && input.action !== "uninstall")
    throw new Error("invalid", "keepData is only valid for uninstall")
  if (input.action === "add-source") {
    const target = await resolveSource(input.source ?? "")
    if (!isMarketplaceAllowed(policy, target.location))
      throw new Error("invalid", "Plugin source is blocked by strict_known_marketplaces policy")
    const id = hash(JSON.stringify(target))
    if (value.sources.some((s) => s.info.location === target.location)) return catalog(root)
    const source = await refresh(
      root,
      {
        info: {
          id,
          name: path.basename(target.location, ".git"),
          location: target.location,
          official: target.location === official,
        },
        entries: [],
      },
      target,
    )
    await save(root, { ...value, sources: [...value.sources, source] })
    return catalog(root)
  }
  if (input.action === "remove-source") {
    if (!value.sources.some((s) => s.info.id === input.id)) throw new Error("missing", "Plugin source not found")
    await save(root, { ...value, sources: value.sources.filter((s) => s.info.id !== input.id) })
    return catalog(root)
  }
  if (input.action === "refresh") {
    const sources = await Promise.all(
      value.sources.map(async (s) => {
        if (input.id && s.info.id !== input.id) return s
        return refresh(root, s).catch((error: unknown) => ({
          ...s,
          info: { ...s.info, error: error instanceof globalThis.Error ? error.message : String(error) },
        }))
      }),
    )
    await save(root, { ...value, sources })
    return catalog(root)
  }
  const matches = value.installed.filter((v) => v.item.id === input.id || v.item.name === input.id)
  if (matches.length > 1) throw new Error("invalid", "Multiple plugins have this name. Use the full plugin ID.")
  const current = matches[0]
  // Downloading an already installed package must not fetch or replace its trusted snapshot.
  if (input.action === "download" && current) return catalog(root)
  if (input.action === "update" && !current) throw new Error("missing", "Installed plugin not found")
  if (input.action === "install" && current?.item.status === "downloaded") {
    if (!input.trust) throw new Error("trust", "Review the plugin and pass --trust to install it")
    if (isPluginDisabledByPolicy(policy, current.item.id, current.item.name))
      throw new Error("invalid", `Plugin ${current.item.name} is disabled by policy`)
    if (
      value.installed.some(
        (v) => v.item.id !== current.item.id && v.item.name === current.item.name && v.item.status === "enabled",
      )
    )
      throw new Error("invalid", "Disable the other plugin with this name first")
    await save(root, {
      ...value,
      installed: value.installed.map((v) =>
        v === current ? { ...v, trusted: true, item: { ...v.item, status: "enabled" as const } } : v,
      ),
    })
    return catalog(root)
  }
  if (["enable", "disable", "uninstall"].includes(input.action)) {
    if (!current) throw new Error("missing", "Installed plugin not found")
    if (input.action === "enable" && isPluginDisabledByPolicy(policy, current.item.id, current.item.name))
      throw new Error("invalid", `Plugin ${current.item.name} is disabled by policy`)
    if (input.action === "enable" && !current.trusted && !input.trust)
      throw new Error("trust", "Review the plugin and pass --trust to enable it")
    if (
      input.action === "enable" &&
      value.installed.some(
        (v) => v.item.id !== current.item.id && v.item.name === current.item.name && v.item.status === "enabled",
      )
    )
      throw new Error("invalid", "Disable the other plugin with this name before enabling this one")
    const installed =
      input.action === "uninstall"
        ? value.installed.filter((v) => v !== current)
        : value.installed.map((v) =>
            v === current
              ? {
                  ...v,
                  trusted: v.trusted || input.trust === true,
                  item: { ...v.item, status: input.action === "enable" ? ("enabled" as const) : ("disabled" as const) },
                }
              : v,
          )
    const retired =
      input.action === "uninstall" && !input.keepData
        ? (value.data ?? []).map((entry) => (entry.id === current.item.id ? { ...entry, retired: true } : entry))
        : (value.data ?? [])
    // Persist retirement before any removal. A crash cannot reactivate a deleting epoch.
    await save(root, { ...value, installed, data: retired })
    await save(root, { ...value, installed, data: await cleanData(root, retired) })
    // Keep immutable snapshots for in-flight sessions; remove package directory when no readers hold it.
    if (
      input.action === "uninstall" &&
      !retired.some((entry) => entry.id === current.item.id && entry.readers.length > 0) &&
      current.root.startsWith(`${path.join(root, "packages")}${path.sep}`)
    ) {
      await fs.rm(current.root, { recursive: true, force: true }).catch(() => undefined)
    }
    return catalog(root)
  }
  if (input.action !== "download" && !input.trust)
    throw new Error(
      "trust",
      "Plugins can execute code and access your files. Review the source and pass --trust to install or update.",
    )
  const candidates = value.sources
    .flatMap((s) => s.entries)
    .filter((v) => v.item.id === input.id || v.item.name === input.id)
  if (candidates.length > 1) throw new Error("invalid", "Multiple plugins have this name. Use the full plugin ID.")
  const entry = candidates[0] ?? (input.source ? undefined : current)
  const source = input.source ?? (input.id?.includes("/") ? input.id : undefined)
  if (!entry && !source)
    throw new Error("missing", "Plugin not found; refresh sources or provide a Git URL or local folder")
  const target = entry?.target ?? (await resolveSource(source!))
  if (!isMarketplaceAllowed(policy, target.location))
    throw new Error("invalid", "Plugin source is blocked by strict_known_marketplaces policy")
  if (policy.requireSha && (!target.ref || !/^[a-f0-9]{40}$/.test(target.ref)))
    throw new Error("invalid", "Plugin policy requires a pinned 40-character commit SHA (require_sha)")
  const fetched = await fetchSource(root, target)
  const inspected = await inspect(
    fetched.root,
    entry?.item.name ?? path.basename(target.subdir ?? target.location, ".git"),
  )
  const id = entry?.item.id ?? `local:${hash(JSON.stringify(target))}:${inspected.name}`
  if (input.action !== "download" && isPluginDisabledByPolicy(policy, id, inspected.name))
    throw new Error("invalid", `Plugin ${inspected.name} is disabled by policy`)
  if (
    input.action !== "download" &&
    value.installed.some((v) => v.item.id !== id && v.item.name === inspected.name && v.item.status === "enabled")
  )
    throw new Error("invalid", "Disable the other plugin with this name before installing this one")
  const directory = path.join(root, "packages", `${hash(id)}-${randomUUID()}`)
  await copyTree(fetched.root, directory)
  const { PluginBundle } = await import("./plugin-bundle")
  await PluginBundle.read(directory, inspected.name)
  const item: PluginStore.Item = {
    id,
    name: inspected.name,
    description: inspected.description || entry?.item.description || "",
    sourceID: entry?.item.sourceID ?? "custom",
    source: entry?.item.source ?? target.location,
    category: entry?.item.category ?? "other",
    recommended: entry?.item.recommended ?? false,
    author: inspected.author ?? entry?.item.author,
    homepage: inspected.homepage ?? entry?.item.homepage,
    version: inspected.version ?? entry?.item.version,
    revision: fetched.revision,
    components: inspected.components,
    warnings: inspected.warnings,
    path: directory,
    status:
      input.action === "download"
        ? current?.item.status === "enabled"
          ? "enabled"
          : "downloaded"
        : current?.item.status === "disabled"
          ? "disabled"
          : "enabled",
  }
  await save(root, {
    ...value,
    installed: [
      ...value.installed.filter((v) => v.item.id !== id),
      { item, root: directory, target, trusted: input.action !== "download" },
    ],
  })
  return catalog(root)
}

async function resolveSource(input: string): Promise<typeof Location.Type> {
  const source = input.trim()
  if (!source || source.startsWith("-") || /[\r\n\0]/.test(source)) throw new Error("invalid", "Invalid plugin source")
  if (source.startsWith(".") || path.isAbsolute(source) || source.startsWith("~/")) {
    const directory = source.startsWith("~/")
      ? path.join(process.env.APEXO_TEST_HOME ?? process.env.HOME ?? "", source.slice(2))
      : path.resolve(source)
    return {
      location: await fs.realpath(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") throw new Error("invalid", `Plugin path does not exist: ${directory}`)
        throw new Error("invalid", `Could not access plugin path: ${directory}`)
      }),
    }
  }
  const [repository, subdir] = source.split("#")
  const shorthand = /^([\w.-]+\/[\w.-]+)(?:@([\w./-]+))?$/.exec(repository)
  if (shorthand) return { location: `https://github.com/${shorthand[1]}.git`, ref: shorthand[2], subdir }
  if (/^(https:\/\/|ssh:\/\/|git@[\w.-]+:)/.test(repository)) return { location: repository, subdir }
  throw new Error("invalid", "Use a local folder, owner/repo, HTTPS Git URL, or SSH Git URL")
}

async function git(args: string[], cwd?: string) {
  const result = await exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", ...args], {
    cwd,
    timeout: 120_000,
    maxBuffer: 2_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
  return result.stdout.trim()
}

async function fetchSource(root: string, target: typeof Location.Type) {
  const directory = path.isAbsolute(target.location)
    ? await fs.realpath(target.location)
    : path.join(root, "sources", randomUUID())
  if (!path.isAbsolute(target.location)) {
    await resolveSource(target.location)
    await fs.mkdir(path.dirname(directory), { recursive: true })
    await git(["clone", "--depth", "1", "--no-recurse-submodules", "--", target.location, directory])
    if (target.ref) {
      if (target.ref.startsWith("-") || /[\r\n\0]/.test(target.ref)) throw new Error("invalid", "Invalid Git revision")
      await git(["fetch", "--depth", "1", "origin", target.ref], directory)
      await git(["checkout", "--detach", "FETCH_HEAD"], directory)
    }
  }
  const revision = await git(["rev-parse", "HEAD"], directory).catch(() => undefined)
  if (target.ref && /^[a-f0-9]{40}$/.test(target.ref) && revision !== target.ref)
    throw new Error("invalid", "Plugin commit does not match its pinned revision")
  return { root: await contained(directory, target.subdir ?? "."), revision }
}

async function refresh(
  root: string,
  source: typeof Source.Type,
  target = source.target ?? { location: source.info.location },
) {
  const fetched = await fetchSource(root, target)
  const files = [
    ".grok-plugin/marketplace.json",
    ".grok-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".claude-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
  ]
  const index = (await Promise.all(files.map((name) => json(path.join(fetched.root, name))))).find((v) =>
    Array.isArray(record(v).plugins),
  )
  if (!index) throw new Error("invalid", "No plugin catalog found in this source")
  const data = record(index)
  const summaries = record(record(await json(path.join(fetched.root, ".grok-plugin/plugin-index.json"))).plugins)
  const names = new Set<string>()
  const entries = await Promise.all(
    (data.plugins as unknown[]).map(async (plugin): Promise<Entry> => {
      const item = record(plugin)
      const name = string(item.name) ?? ""
      if (!namePattern.test(name) || names.has(name)) throw new Error("invalid", "Invalid or duplicate plugin name")
      names.add(name)
      const origin = typeof item.source === "string" ? { path: item.source } : record(item.source)
      const url = string(origin.url)
      const ref = string(origin.sha) ?? string(origin.ref)
      const subdir = string(origin.path)
      if (!url && !subdir) throw new Error("invalid", `Missing source for ${name}`)
      const target = url
        ? { ...(await resolveSource(url)), ref, subdir }
        : { location: await contained(fetched.root, subdir!), ...(ref ? { ref } : {}) }
      const summary = record(summaries[name])
      const components = !ref || summary.sha === ref ? record(summary.components) : {}
      return {
        target,
        item: {
          id: `${source.info.id}:${name}`,
          name,
          description: cleanBranding(string(item.description) ?? ""),
          sourceID: source.info.id,
          source: source.info.location,
          category: string(item.category) ?? "other",
          author: string(record(item.author).name) ?? string(item.author),
          homepage: string(item.homepage),
          version: string(item.version) ?? string(summary.version),
          revision: ref ?? fetched.revision,
          recommended: source.info.official,
          status: "available",
          warnings: [],
          components: kinds.flatMap((kind) =>
            Array.isArray(components[kind])
              ? (components[kind] as unknown[]).flatMap((c) =>
                  string(record(c).name)
                    ? [{ kind, name: string(record(c).name)!, description: string(record(c).description) }]
                    : [],
                )
              : [],
          ),
        },
      }
    }),
  )
  return {
    info: {
      ...source.info,
      name: cleanBranding(string(data.name) ?? source.info.name),
      error: undefined,
      updatedAt: Date.now(),
    },
    root: fetched.root,
    target,
    entries,
  }
}

export async function contained(root: string, relative: string) {
  if (path.isAbsolute(relative) || relative.includes("\\")) throw new Error("invalid", "Plugin path must be relative")
  const base = await fs.realpath(root)
  const target = await fs.realpath(path.resolve(base, relative))
  const rel = path.relative(base, target)
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error("invalid", "Plugin path escapes its package")
  return target
}

async function copyTree(root: string, target: string) {
  const files = await walk(root)
  if (files.length > 20_000) throw new Error("invalid", "Plugin has too many files")
  const sizes = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file)
      if (stat.size > 20_000_000) throw new Error("invalid", "Plugin contains an oversized file")
      return stat.size
    }),
  )
  if (sizes.reduce((a, b) => a + b, 0) > 200_000_000) throw new Error("invalid", "Plugin exceeds the download limit")
  await fs.mkdir(target, { recursive: true })
  for (const file of files) {
    const dest = path.join(target, path.relative(root, file))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(file, dest)
    await fs.chmod(dest, (await fs.stat(file)).mode & 0o777)
  }
}

export async function walk(root: string, count = { value: 0 }, depth = 0): Promise<string[]> {
  if (depth > 64) throw new Error("invalid", "Plugin directory nesting is too deep")
  const entries = await fs.readdir(root, { withFileTypes: true })
  count.value += entries.length
  if (count.value > 20_000) throw new Error("invalid", "Plugin has too many files")
  return (
    await Promise.all(
      entries
        .filter((v) => ![".git", "node_modules"].includes(v.name))
        .map(async (entry) => {
          const file = path.join(root, entry.name)
          // No links are copied into installed packages; this also prevents recursive link cycles.
          if (entry.isSymbolicLink()) throw new Error("invalid", "Plugin packages must not contain symbolic links")
          if (entry.isDirectory()) return walk(file, count, depth + 1)
          if (!entry.isFile()) throw new Error("invalid", "Unsupported plugin file type")
          return [file]
        }),
    )
  ).flat()
}

export async function inspect(root: string, fallbackName = path.basename(root)) {
  const files = await walk(root)
  const manifests = await Promise.all(
    [".grok-plugin/plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"].map((file) =>
      json(path.join(root, file)),
    ),
  )
  const manifest = record(manifests.find((v) => v !== undefined))
  const name = string(manifest.name) ?? fallbackName
  if (!namePattern.test(name)) throw new Error("invalid", "Invalid plugin name")
  const components: PluginStore.Component[] = []
  for (const kind of ["skills", "commands", "agents"] as const) {
    const paths = typeof manifest[kind] === "string" ? [manifest[kind] as string] : strings(manifest[kind])
    const roots = paths.length ? await Promise.all(paths.map((p) => contained(root, p))) : [path.join(root, kind)]
    for (const file of files.filter(
      (f) =>
        roots.some((r) => f === r || f.startsWith(`${r}${path.sep}`)) &&
        (kind === "skills" ? path.basename(f) === "SKILL.md" : f.endsWith(".md")),
    )) {
      const md = ConfigMarkdown.parse(await fs.readFile(file, "utf8"))
      components.push({
        kind,
        name: string(md.data.name) ?? path.basename(kind === "skills" ? path.dirname(file) : file, ".md"),
        description: string(md.data.description),
      })
    }
  }
  for (const [kind, fallback] of [
    ["mcpServers", ".mcp.json"],
    ["lspServers", ".lsp.json"],
    ["hooks", "hooks/hooks.json"],
  ] as const) {
    const declared = manifest[kind]
    const config =
      typeof declared === "object"
        ? record(declared)
        : record(
            await json(
              path.join(
                root,
                typeof declared === "string" ? path.relative(root, await contained(root, declared)) : fallback,
              ),
            ),
          )
    const entries = record(config[kind] ?? config)
    components.push(...Object.keys(entries).map((name) => ({ kind, name })))
  }
  if (!components.length) throw new Error("invalid", "No supported plugin components found")
  return {
    name,
    manifest,
    files,
    components,
    description: cleanBranding(string(manifest.description) ?? ""),
    version: string(manifest.version),
    author: string(record(manifest.author).name) ?? string(manifest.author),
    homepage: string(manifest.homepage),
    // Command/HTTP hooks work, but provider-specific hook decisions and prompt/agent hooks are partial.
    warnings: components.some((v) => v.kind === "hooks") ? ["hooks"] : [],
  }
}

export type Validation = {
  kind: "plugin" | "marketplace"
  path: string
  name?: string
  version?: string
  errors: string[]
  warnings: string[]
  plugins: { name: string; errors: string[]; warnings: string[] }[]
}

const catalogFiles = [
  ".grok-plugin/marketplace.json",
  ".grok-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
]
const manifestFiles = [
  ".grok-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "plugin.json",
]
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const reason = (error: unknown) => (error instanceof globalThis.Error ? error.message : String(error))

async function readJSON(root: string, files: string[], errors: string[]) {
  const found: { file: string; value: unknown }[] = []
  for (const file of files) {
    const value = await json(path.join(root, file)).catch((error) => {
      errors.push(`${file}: ${reason(error)}`)
      return undefined
    })
    if (value !== undefined) found.push({ file, value })
  }
  return found
}

async function validatePlugin(root: string) {
  const errors: string[] = []
  const warnings: string[] = []
  const manifest = (await readJSON(root, manifestFiles, errors))[0]
  const data = record(manifest?.value)
  if (manifest && data.name === undefined) warnings.push(`${manifest.file}: no "name"; the folder name is used`)
  const version = string(data.version)
  if (manifest && !version) warnings.push(`${manifest.file}: no "version"; plugin tag needs one`)
  if (version && !semver.test(version)) errors.push(`${manifest!.file}: version "${version}" is not semver`)
  for (const file of [".mcp.json", ".lsp.json", "hooks/hooks.json"])
    await json(path.join(root, file)).catch((error) => errors.push(`${file}: ${reason(error)}`))
  const info = await inspect(root).catch((error) => {
    errors.push(reason(error))
    return undefined
  })
  if (info) {
    for (const item of info.components)
      if ((item.kind === "skills" || item.kind === "commands" || item.kind === "agents") && !item.description)
        warnings.push(`${item.kind}/${item.name}: no description in frontmatter`)
  }
  return { name: info?.name ?? string(data.name) ?? path.basename(root), version, errors, warnings }
}

/** `grok plugin validate [<path>]`: checks a plugin folder or a marketplace repository before publishing. */
export async function validate(input: string): Promise<Validation> {
  const root = path.resolve(input)
  const stat = await fs.stat(root).catch(() => undefined)
  if (!stat?.isDirectory())
    return { kind: "plugin", path: root, errors: [`${root} is not a directory`], warnings: [], plugins: [] }
  const errors: string[] = []
  const index = (await readJSON(root, catalogFiles, errors)).find((item) => Array.isArray(record(item.value).plugins))
  if (!index) {
    const result = await validatePlugin(root)
    return {
      kind: "plugin",
      path: root,
      name: result.name,
      version: result.version,
      errors: [...errors, ...result.errors],
      warnings: result.warnings,
      plugins: [],
    }
  }
  const data = record(index.value)
  const warnings: string[] = []
  if (!string(data.name)) errors.push(`${index.file}: missing "name"`)
  const names = new Set<string>()
  const plugins: Validation["plugins"] = []
  for (const [position, raw] of (data.plugins as unknown[]).entries()) {
    const item = record(raw)
    const name = string(item.name) ?? ""
    const label = name || `plugins[${position}]`
    if (!namePattern.test(name)) errors.push(`${label}: invalid plugin name`)
    else if (names.has(name)) errors.push(`${label}: duplicate plugin name`)
    names.add(name)
    if (!string(item.description)) warnings.push(`${label}: no description`)
    const source = typeof item.source === "string" ? { type: "local", path: item.source } : record(item.source)
    const local = string(source.path)
    if (local && (source.type === "local" || source.type === undefined)) {
      const dir = await contained(root, local).catch(() => undefined)
      if (!dir) {
        errors.push(`${label}: source path ${local} escapes the repository`)
        continue
      }
      const result = await validatePlugin(dir)
      if (name && result.name !== name)
        result.warnings.push(`manifest name "${result.name}" differs from index "${name}"`)
      plugins.push({ name: label, errors: result.errors, warnings: result.warnings })
      continue
    }
    const url = string(source.url) ?? string(source.repo)
    if (!url) {
      errors.push(`${label}: source needs a local "path" or a git "url"`)
      continue
    }
    const sha = string(source.sha)
    if (!sha) warnings.push(`${label}: url source has no pinned "sha"; installs are not reproducible`)
    else if (!/^[a-f0-9]{40}$/.test(sha)) errors.push(`${label}: "sha" must be a full 40-character commit sha`)
  }
  return { kind: "marketplace", path: root, name: string(data.name), errors, warnings, plugins }
}

const run = promisify(execFile)

/** `grok plugin tag [<path>] [--push]`: tags a release from the plugin manifest version. */
export async function tag(input: string, options: { push?: boolean } = {}) {
  const result = await validate(input)
  if (result.kind !== "plugin") throw new Error("invalid", "plugin tag needs a plugin folder, not a marketplace")
  if (result.errors.length) throw new Error("invalid", `plugin is invalid: ${result.errors.join("; ")}`)
  if (!result.version) throw new Error("invalid", "plugin manifest has no version to tag")
  const git = (...args: string[]) => run("git", ["-C", result.path, ...args]).then((out) => out.stdout.trim())
  const top = await git("rev-parse", "--show-toplevel").catch(() => {
    throw new Error("invalid", `${result.path} is not inside a git repository`)
  })
  const [realTop, realPlugin] = await Promise.all([
    fs.realpath(top).catch(() => path.resolve(top)),
    fs.realpath(result.path).catch(() => result.path),
  ])
  // A plugin at the repository root is tagged v1.2.3; one inside a marketplace repo is tagged name-v1.2.3.
  const name = realTop === realPlugin ? `v${result.version}` : `${result.name}-v${result.version}`
  if (await git("tag", "--list", name)) throw new Error("invalid", `tag ${name} already exists`)
  const [userName, userEmail] = await Promise.all([
    git("config", "user.name").catch(() => ""),
    git("config", "user.email").catch(() => ""),
  ])
  const identityArgs = [
    ...(userName || process.env.GIT_COMMITTER_NAME ? [] : ["-c", "user.name=apexo"]),
    ...(userEmail || process.env.GIT_COMMITTER_EMAIL ? [] : ["-c", "user.email=plugin@apexo.local"]),
  ]
  await git(...identityArgs, "-c", "tag.gpgSign=false", "tag", "-a", name, "-m", `${result.name} ${result.version}`)
  if (options.push) await git("push", "origin", name)
  return { tag: name, pushed: !!options.push, name: result.name, version: result.version }
}
