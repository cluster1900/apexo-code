export * as CommandSandboxPaths from "./paths"

import { lstat, mkdir, readFile, readlink, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { parse } from "toml"
import { CommandSandboxPolicy } from "./policy"

const EXTENDABLE_PROFILES = new Set<CommandSandboxPolicy.BaseProfile>(["workspace", "read-only", "strict", "devbox"])
const BUILTIN_NAMES = new Set(["off", "none", "workspace", "read-only", "strict", "devbox"])
const HOOK_CONFIG_CANDIDATES = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".cursor/hooks.json",
  ".grok/hooks",
  ".grok/lsp.json",
  ".grok/sandbox.toml",
  ".apexo/sandbox.toml",
]
const STRICT_SYSTEM_READ_ROOTS = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/Library",
  "/opt/homebrew",
  "/etc",
  "/private/etc",
  "/var/select",
  "/private/var/select",
  "/dev",
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/private/var/tmp",
  "/Users/Shared",
]

interface CustomProfileConfig {
  readonly extends?: CommandSandboxPolicy.BaseProfile
  readonly read_only: string[]
  readonly read_write: string[]
  readonly deny: string[]
  readonly restrict_network?: boolean
}

interface SandboxTomlConfig {
  readonly deny: string[]
  readonly profiles: Map<string, CustomProfileConfig>
}

export const resolve = (input: {
  readonly workspace: string
  readonly profile: string
  readonly protected: ReadonlyArray<string>
  readonly home?: string
  readonly grokHome?: string
  readonly extraDenyLiterals?: ReadonlyArray<string>
  readonly extraDenyGlobs?: ReadonlyArray<CommandSandboxPolicy.DenyGlob>
}) =>
  Effect.tryPromise({
    try: async () => {
      if (!path.isAbsolute(input.workspace) || input.workspace.includes("\0"))
        throw new CommandSandboxPolicy.Failure({
          code: "unsafe_path",
          message: "Workspace must be an absolute path.",
        })
      const original = await lstat(input.workspace).catch(() => {
        throw new CommandSandboxPolicy.Failure({
          code: "unsafe_path",
          message: "Workspace must be an existing directory.",
        })
      })
      if (!original.isDirectory() || original.isSymbolicLink())
        throw new CommandSandboxPolicy.Failure({
          code: "unsafe_path",
          message: "Workspace must be a real directory.",
        })
      const workspace = await realpath(input.workspace)
      const home = input.home ?? process.env.HOME ?? homedir()
      const grokHome = input.grokHome ?? process.env.GROK_HOME ?? path.join(home, ".grok")
      const userConfig = await loadSandboxToml(path.join(grokHome, "sandbox.toml"))
      const projectGrokConfig = await loadSandboxToml(path.join(workspace, ".grok", "sandbox.toml"))
      const projectApexoConfig = await loadSandboxToml(path.join(workspace, ".apexo", "sandbox.toml"))

      const resolvedProfile = resolveProfileSelection(input.profile, userConfig, projectGrokConfig, projectApexoConfig)
      const readOnly = await resolveAllowDirectories(resolvedProfile.readOnly, home, false)
      const readWrite = await resolveAllowDirectories(resolvedProfile.readWrite, home, true)
      const rawDenies = [
        ...userConfig.deny,
        ...projectGrokConfig.deny,
        ...projectApexoConfig.deny,
        ...resolvedProfile.deny,
      ]
      const compiledDenies = await compileDenyEntries(rawDenies, workspace, home)
      const denyLiterals = [
        ...new Set([...compiledDenies.literals, ...(input.extraDenyLiterals ?? [])]),
      ].sort()
      const denyGlobMap = new Map<string, CommandSandboxPolicy.DenyGlob>()
      for (const glob of [...compiledDenies.globs, ...(input.extraDenyGlobs ?? [])]) {
        denyGlobMap.set(`${glob.pattern}\0${glob.regex}`, glob)
      }
      const denyGlobs = [...denyGlobMap.values()]

      const symlinkTargets = await resolveSymlinkedHookConfigTargets(workspace)
      const protectedPaths = [...new Set([...input.protected, ...symlinkTargets])].sort()
      if (protectedPaths.length > 192)
        throw new CommandSandboxPolicy.Failure({
          code: "unsafe_path",
          message: "Too many protected paths.",
        })
      const entries = await Promise.all([workspace, ...protectedPaths].map(inspect))
      const protectedCanonical = [...new Set(entries.slice(1).map((entry) => entry.path))].sort()
      const ancestors = [...new Set(entries.flatMap((entry) => parents(entry.path)))].sort()
      if (ancestors.length > 256)
        throw new CommandSandboxPolicy.Failure({
          code: "unsafe_path",
          message: "Too many protected ancestors.",
        })
      const identities = [...new Map(entries.map((entry) => [entry.identity.path, entry.identity])).values()]
      const standardProfile = input.profile === "workspace" || input.profile === "read-only"
      const policy = {
        version: 1 as const,
        scope: "native_commands" as const,
        profile: input.profile,
        ...(standardProfile && resolvedProfile.base === input.profile ? {} : { base: resolvedProfile.base }),
        network: resolvedProfile.network,
        workspace,
        identities,
        protected: protectedCanonical,
        ancestors,
        ...(readOnly.length > 0 ? { readOnly } : {}),
        ...(readWrite.length > 0 ? { readWrite } : {}),
        ...(denyLiterals.length > 0 ? { denyLiterals } : {}),
        ...(denyGlobs.length > 0 ? { denyGlobs } : {}),
      }
      return CommandSandboxPolicy.freeze({ ...policy, revision: CommandSandboxPolicy.revision(policy) })
    },
    catch: (error) =>
      error instanceof CommandSandboxPolicy.Failure
        ? error
        : new CommandSandboxPolicy.Failure({
            code: "unsafe_path",
            message: "The command sandbox paths could not be safely resolved.",
          }),
  })

export const verify = (policy: CommandSandboxPolicy.Confined) =>
  Effect.tryPromise({
    try: async () => {
      await Promise.all(
        policy.identities.map(async (identity) => {
          const current = await lstat(identity.path, { bigint: true })
          if (
            current.isSymbolicLink() ||
            current.dev.toString() !== identity.dev ||
            current.ino.toString() !== identity.ino ||
            current.isDirectory() !== identity.directory ||
            (!identity.directory && current.nlink !== 1n)
          )
            throw new Error("Sandbox authority path changed")
        }),
      )
      // A previously absent protected name may now exist; validate its canonical destination too.
      await Promise.all(
        policy.protected.map(async (value) => {
          const current = await inspect(value)
          if (current.path !== value) throw new Error("Protected path changed destination")
        }),
      )
    },
    catch: () =>
      new CommandSandboxPolicy.Failure({
        code: "unsafe_path",
        message: "A command sandbox authority path changed or became unsafe.",
      }),
  })

export async function resolveTarget(rawPath: string, cwd = "/"): Promise<{ lexical: string; canonical: string }> {
  if (!rawPath || rawPath.includes("\0") || Buffer.byteLength(rawPath) > 4096)
    throw new CommandSandboxPolicy.Failure({
      code: "unsafe_path",
      message: "Sandbox target path is invalid.",
    })
  const absolute = path.resolve(cwd, rawPath)
  const parent = path.dirname(absolute)
  const parentCanonical = await canonicalizeFollowingSymlinks(parent, 0)
  const lexical = parent === absolute ? parentCanonical : path.join(parentCanonical, path.basename(absolute))
  const canonical = await canonicalizeFollowingSymlinks(absolute, 0)
  return { lexical, canonical }
}

export function isDenied(policy: CommandSandboxPolicy.Confined, lexical: string, canonical: string): boolean {
  const candidates = lexical === canonical ? [canonical] : [lexical, canonical]
  const literals = policy.denyLiterals ?? []
  const globs = policy.denyGlobs ?? []
  return candidates.some(
    (candidate) =>
      literals.some((deny) => isSameOrSubpath(candidate, deny)) ||
      globs.some((glob) => new RegExp(glob.regex).test(candidate)),
  )
}

export function isProtectedOrAncestor(
  policy: CommandSandboxPolicy.Confined,
  lexical: string,
  canonical: string,
): boolean {
  const candidates = lexical === canonical ? [canonical] : [lexical, canonical]
  return candidates.some(
    (candidate) =>
      policy.protected.some((prot) => isSameOrSubpath(candidate, prot)) || policy.ancestors.includes(candidate),
  )
}

export function canRead(policy: CommandSandboxPolicy.Confined, lexical: string, canonical: string): boolean {
  if (isDenied(policy, lexical, canonical)) return false
  if (CommandSandboxPolicy.baseProfile(policy) !== "strict") return true
  const allowedRoots = [
    policy.workspace,
    ...(policy.readOnly ?? []),
    ...(policy.readWrite ?? []),
    ...STRICT_SYSTEM_READ_ROOTS,
  ]
  return allowedRoots.some((root) => isSameOrSubpath(canonical, root))
}

export function canWrite(policy: CommandSandboxPolicy.Confined, lexical: string, canonical: string): boolean {
  if (isDenied(policy, lexical, canonical)) return false
  if (isProtectedOrAncestor(policy, lexical, canonical)) return false
  if (CommandSandboxPolicy.allowsWorkspaceWrites(policy) && isSubpath(canonical, policy.workspace)) return true
  return (policy.readWrite ?? []).some((rw) => isSameOrSubpath(canonical, rw))
}

function isSameOrSubpath(candidate: string, root: string): boolean {
  if (root === "/") return candidate.startsWith("/")
  return candidate === root || candidate.startsWith(`${root}/`)
}

function isSubpath(candidate: string, root: string): boolean {
  if (root === "/") return candidate.length > 1 && candidate.startsWith("/")
  return candidate.startsWith(`${root}/`)
}

async function canonicalizeFollowingSymlinks(target: string, depth: number): Promise<string> {
  if (depth > 32)
    throw new CommandSandboxPolicy.Failure({
      code: "unsafe_path",
      message: "Sandbox target path exceeded symbolic link recursion limit.",
    })
  const normalized = path.resolve(target)
  const existing = await realpath(normalized).catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (existing !== undefined) return existing
  const linkInfo = await lstat(normalized).catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (linkInfo?.isSymbolicLink()) {
    const linkTarget = await readlink(normalized)
    const parentCanonical = await canonicalizeFollowingSymlinks(path.dirname(normalized), depth + 1)
    return canonicalizeFollowingSymlinks(path.resolve(parentCanonical, linkTarget), depth + 1)
  }
  const parent = path.dirname(normalized)
  if (parent === normalized) return normalized
  const parentCanonical = await canonicalizeFollowingSymlinks(parent, depth)
  return path.join(parentCanonical, path.basename(normalized))
}

async function resolveSymlinkedHookConfigTargets(workspace: string): Promise<string[]> {
  const resolved: string[] = []
  for (const relative of HOOK_CONFIG_CANDIDATES) {
    const candidate = path.join(workspace, relative)
    const metadata = await lstat(candidate).catch((error: unknown) => {
      if (isNotFound(error)) return undefined
      throw error
    })
    if (!metadata) continue
    if (metadata.isSymbolicLink()) {
      const target = await realpath(candidate).catch(() => {
        throw new CommandSandboxPolicy.Failure({
          code: "unsafe_path",
          message: `Protected hook or tool config symlink ${relative} could not be resolved.`,
        })
      })
      resolved.push(target)
    }
  }
  return resolved
}

async function loadSandboxToml(filePath: string): Promise<SandboxTomlConfig> {
  const metadata = await lstat(filePath).catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (!metadata) return { deny: [], profiles: new Map() }
  const text = await readFile(filePath, "utf8").catch(() => {
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Failed to read sandbox policy file: ${filePath}`,
    })
  })
  const parsed = (() => {
    try {
      return parse(text)
    } catch {
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `Failed to parse sandbox.toml at ${filePath}`,
      })
    }
  })()
  if (!isPlainObject(parsed))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Invalid top-level table in ${filePath}`,
    })
  for (const key of Object.keys(parsed)) {
    if (key !== "filesystem" && key !== "profiles")
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `Unknown top-level key '${key}' in ${filePath}`,
      })
  }
  const deny: string[] = []
  if ("filesystem" in parsed && parsed.filesystem !== undefined) {
    if (!isPlainObject(parsed.filesystem))
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `Invalid [filesystem] table in ${filePath}`,
      })
    for (const key of Object.keys(parsed.filesystem)) {
      if (key !== "deny")
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `Unknown [filesystem] key '${key}' in ${filePath}`,
        })
    }
    if ("deny" in parsed.filesystem && parsed.filesystem.deny !== undefined) {
      deny.push(...requireStringArray(parsed.filesystem.deny, `[filesystem].deny in ${filePath}`))
    }
  }
  const profiles = new Map<string, CustomProfileConfig>()
  if ("profiles" in parsed && parsed.profiles !== undefined) {
    if (!isPlainObject(parsed.profiles))
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `Invalid [profiles] table in ${filePath}`,
      })
    for (const [name, raw] of Object.entries(parsed.profiles)) {
      if (!name.trim() || name.trim() !== name || BUILTIN_NAMES.has(name))
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `Invalid or reserved sandbox profile name '${name}' in ${filePath}`,
        })
      if (!isPlainObject(raw))
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `Invalid [profiles.${name}] table in ${filePath}`,
        })
      for (const key of Object.keys(raw)) {
        if (!["extends", "read_only", "read_write", "deny", "restrict_network"].includes(key))
          throw new CommandSandboxPolicy.Failure({
            code: "invalid_policy",
            message: `Unknown key '${key}' in [profiles.${name}] in ${filePath}`,
          })
      }
      const ext = raw.extends
      if (ext !== undefined && (typeof ext !== "string" || !EXTENDABLE_PROFILES.has(ext as CommandSandboxPolicy.BaseProfile)))
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `Profile '${name}' in ${filePath} extends unsupported base '${String(ext)}'`,
        })
      if (raw.restrict_network !== undefined && typeof raw.restrict_network !== "boolean")
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `Profile '${name}' restrict_network must be a boolean in ${filePath}`,
        })
      profiles.set(name, {
        extends: ext as CommandSandboxPolicy.BaseProfile | undefined,
        read_only: raw.read_only !== undefined ? requireStringArray(raw.read_only, `[profiles.${name}].read_only`) : [],
        read_write:
          raw.read_write !== undefined ? requireStringArray(raw.read_write, `[profiles.${name}].read_write`) : [],
        deny: raw.deny !== undefined ? requireStringArray(raw.deny, `[profiles.${name}].deny`) : [],
        restrict_network: raw.restrict_network as boolean | undefined,
      })
    }
  }
  return { deny, profiles }
}

function resolveProfileSelection(
  profile: string,
  user: SandboxTomlConfig,
  projectGrok: SandboxTomlConfig,
  projectApexo: SandboxTomlConfig,
): {
  readonly base: CommandSandboxPolicy.BaseProfile
  readonly network: "off" | "unrestricted"
  readonly readOnly: string[]
  readonly readWrite: string[]
  readonly deny: string[]
} {
  if (EXTENDABLE_PROFILES.has(profile as CommandSandboxPolicy.BaseProfile)) {
    const base = profile as CommandSandboxPolicy.BaseProfile
    return {
      base,
      network: base === "devbox" ? "unrestricted" : "off",
      readOnly: [],
      readWrite: [],
      deny: [],
    }
  }
  const custom =
    user.profiles.get(profile) ?? projectGrok.profiles.get(profile) ?? projectApexo.profiles.get(profile)
  if (!custom)
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Unknown command sandbox profile: ${profile}`,
    })
  const base = custom.extends ?? "workspace"
  const network =
    custom.restrict_network !== undefined
      ? custom.restrict_network
        ? "off"
        : "unrestricted"
      : base === "devbox"
        ? "unrestricted"
        : "off"
  return {
    base,
    network,
    readOnly: custom.read_only,
    readWrite: custom.read_write,
    deny: custom.deny,
  }
}

async function resolveAllowDirectories(
  entries: ReadonlyArray<string>,
  home: string,
  createIfMissing: boolean,
): Promise<string[]> {
  const results: string[] = []
  for (const raw of entries) {
    if (!raw || raw.trim() !== raw || raw.includes("\0")) continue
    const expanded = raw === "~" ? home : raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw
    const stripped = expanded.endsWith("/**")
      ? expanded.slice(0, -3)
      : expanded.endsWith("/*")
        ? expanded.slice(0, -2)
        : expanded
    if (!stripped || hasGlobChars(stripped) || !path.isAbsolute(stripped)) continue
    if (createIfMissing) {
      await mkdir(stripped, { recursive: true }).catch(() => undefined)
    }
    const resolved = await realpath(stripped).catch(() => undefined)
    if (!resolved) continue
    const info = await stat(resolved).catch(() => undefined)
    if (!info?.isDirectory()) continue
    results.push(resolved)
  }
  return [...new Set(results)].sort()
}

async function compileDenyEntries(
  rawEntries: ReadonlyArray<string>,
  workspace: string,
  home: string,
): Promise<{ literals: string[]; globs: CommandSandboxPolicy.DenyGlob[] }> {
  const seen = new Set<string>()
  const literals: string[] = []
  const globs: CommandSandboxPolicy.DenyGlob[] = []
  for (const raw of rawEntries) {
    if (seen.has(raw)) continue
    seen.add(raw)
    validateRawDeny(raw)
    const anchored = anchorDeny(raw, workspace, home)
    validateAnchoredDenySyntax(anchored, raw)
    if (!hasGlobChars(anchored)) {
      const target = await resolveTarget(anchored)
      literals.push(target.canonical)
      if (target.lexical !== target.canonical) literals.push(target.lexical)
      continue
    }
    const segments = anchored.slice(1).split("/")
    const firstGlobIndex = segments.findIndex(hasGlobChars)
    const prefixSegments = segments.slice(0, firstGlobIndex)
    const suffixSegments = segments.slice(firstGlobIndex)
    const rawPrefix = prefixSegments.length === 0 ? "/" : `/${prefixSegments.join("/")}`
    const resolvedPrefix = await resolveTarget(rawPrefix)
    const canonicalPattern =
      resolvedPrefix.canonical === "/"
        ? `/${suffixSegments.join("/")}`
        : `${resolvedPrefix.canonical}/${suffixSegments.join("/")}`
    const regex = compileGlobToRegex(canonicalPattern, raw)
    globs.push({ pattern: canonicalPattern, regex })
    if (resolvedPrefix.lexical !== resolvedPrefix.canonical) {
      const lexicalPattern =
        resolvedPrefix.lexical === "/"
          ? `/${suffixSegments.join("/")}`
          : `${resolvedPrefix.lexical}/${suffixSegments.join("/")}`
      globs.push({ pattern: lexicalPattern, regex: compileGlobToRegex(lexicalPattern, raw) })
    }
  }
  return { literals: [...new Set(literals)].sort(), globs }
}

function validateRawDeny(raw: string) {
  if (!raw)
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: "sandbox deny entry must not be empty",
    })
  if (raw.trim() !== raw)
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${raw}' must not have leading or trailing whitespace`,
    })
  if (/[\x00-\x1f\x7f]/.test(raw))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${raw}' must not contain control characters`,
    })
}

function anchorDeny(raw: string, workspace: string, home: string): string {
  if (raw === "~" || raw.startsWith("~/")) {
    if (!home || !path.isAbsolute(home) || hasGlobChars(home) || home.includes("//"))
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `sandbox deny entry '${raw}' requires a valid absolute HOME directory`,
      })
    const normalizedHome = home.length > 1 && home.endsWith("/") ? home.slice(0, -1) : home
    if (normalizedHome.split("/").some((segment) => segment === "." || segment === ".."))
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `sandbox deny entry '${raw}' has unsafe HOME segments`,
      })
    const rest = raw.slice(2)
    return !rest ? normalizedHome : normalizedHome === "/" ? `/${rest}` : `${normalizedHome}/${rest}`
  }
  if (raw.startsWith("/")) return raw
  return workspace === "/" ? `/${raw}` : `${workspace}/${raw}`
}

function validateAnchoredDenySyntax(anchored: string, raw: string) {
  if (!anchored.startsWith("/"))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${raw}' did not resolve to an absolute path`,
    })
  if (anchored.length > 1 && anchored.endsWith("/"))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${raw}' must not end with '/'`,
    })
  if (anchored.includes("//"))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${raw}' must not contain empty '//' segments`,
    })
  if (anchored.includes("{") || anchored.includes("}") || anchored.includes("\\"))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${raw}' uses unsupported brace or backslash syntax`,
    })
  for (const segment of anchored.slice(1).split("/")) {
    if (segment === "." || segment === "..")
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `sandbox deny entry '${raw}' must not contain '.' or '..' segments`,
      })
  }
}

export function compileGlobToRegex(anchoredPattern: string, rawLabel = anchoredPattern): string {
  const segments = anchoredPattern === "/" ? [] : anchoredPattern.slice(1).split("/")
  if (segments.length === 0)
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${rawLabel}' cannot target root '/' as a glob`,
    })
  const parts: string[] = ["^"]
  let index = 0
  while (index < segments.length) {
    const segment = segments[index]!
    if (segment === "**") {
      while (index + 1 < segments.length && segments[index + 1] === "**") index++
      if (index === segments.length - 1) {
        parts.push("(/.*)?")
        index++
        break
      }
      parts.push("/(.+/)?")
      index++
      parts.push(compileSegmentToRegex(segments[index]!, rawLabel))
      index++
      continue
    }
    parts.push("/")
    parts.push(compileSegmentToRegex(segment, rawLabel))
    index++
  }
  if (!parts[parts.length - 1]?.endsWith("(/.*)?")) {
    parts.push("(/.*)?")
  }
  parts.push("$")
  const compiled = parts.join("")
  try {
    new RegExp(compiled)
  } catch {
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${rawLabel}' compiled to an invalid regular expression`,
    })
  }
  return compiled
}

function compileSegmentToRegex(segment: string, rawLabel: string): string {
  if (segment.includes("**"))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${rawLabel}' must use '**' as a full path segment`,
    })
  const out: string[] = []
  let i = 0
  while (i < segment.length) {
    const ch = segment[i]!
    if (ch === "*") {
      out.push("[^/]*")
      i++
      continue
    }
    if (ch === "?") {
      out.push("[^/]")
      i++
      continue
    }
    if (ch === "[") {
      const parsed = parseGlobCharClass(segment, i + 1, rawLabel)
      out.push(parsed.regex)
      i = parsed.nextIndex
      continue
    }
    if (".+^$()|}\\".includes(ch)) {
      out.push(`\\${ch}`)
    } else {
      out.push(ch)
    }
    i++
  }
  return out.join("")
}

function parseGlobCharClass(
  segment: string,
  start: number,
  rawLabel: string,
): { regex: string; nextIndex: number } {
  let i = start
  let negated = false
  if (i < segment.length && (segment[i] === "!" || segment[i] === "^")) {
    negated = true
    i++
  }
  if (i < segment.length && segment[i] === "]")
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${rawLabel}' cannot use ']' as first character in [...]`,
    })
  const members: string[] = []
  let closed = false
  while (i < segment.length) {
    const c = segment[i]!
    if (c === "]") {
      closed = true
      i++
      break
    }
    if (c === "/" || c === "[")
      throw new CommandSandboxPolicy.Failure({
        code: "invalid_policy",
        message: `sandbox deny entry '${rawLabel}' has invalid character '${c}' inside [...]`,
      })
    if (i + 2 < segment.length && segment[i + 1] === "-" && segment[i + 2] !== "]") {
      const end = segment[i + 2]!
      if (end === "/" || end === "[")
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `sandbox deny entry '${rawLabel}' has invalid range endpoint '${end}' inside [...]`,
        })
      if (c.charCodeAt(0) > end.charCodeAt(0))
        throw new CommandSandboxPolicy.Failure({
          code: "invalid_policy",
          message: `sandbox deny entry '${rawLabel}' has reversed character range '${c}-${end}'`,
        })
      members.push(`${escapeClassChar(c)}-${escapeClassChar(end)}`)
      i += 3
      continue
    }
    members.push(escapeClassChar(c))
    i++
  }
  if (!closed || members.length === 0)
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `sandbox deny entry '${rawLabel}' has an unclosed or empty character class`,
    })
  return {
    regex: negated ? `[^/${members.join("")}]` : `[${members.join("")}]`,
    nextIndex: i,
  }
}

function escapeClassChar(ch: string): string {
  return ch === "\\" || ch === "^" || ch === "-" ? `\\${ch}` : ch
}

function hasGlobChars(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.includes("[")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new CommandSandboxPolicy.Failure({
      code: "invalid_policy",
      message: `Expected array of strings for ${context}`,
    })
  return value as string[]
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

async function inspect(
  value: string,
): Promise<{ path: string; identity: CommandSandboxPolicy.Confined["identities"][number] }> {
  if (!path.isAbsolute(value) || value.includes("\0") || Buffer.byteLength(value) > 4096)
    throw new Error("Invalid protected path")
  const current = await lstat(value, { bigint: true }).catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (!current) {
    const parent = await inspect(path.dirname(value))
    return { path: path.join(parent.path, path.basename(value)), identity: parent.identity }
  }
  if (current.isSymbolicLink()) throw new Error("Protected paths must not be symbolic links")
  if (!current.isDirectory() && (!current.isFile() || current.nlink !== 1n))
    throw new Error("Protected file must have one link")
  const canonical = await realpath(value)
  const physical = await stat(canonical, { bigint: true })
  return {
    path: canonical,
    identity: {
      path: canonical,
      dev: physical.dev.toString(),
      ino: physical.ino.toString(),
      directory: physical.isDirectory(),
    },
  }
}

function parents(value: string): string[] {
  return value === path.dirname(value) ? [value] : [value, ...parents(path.dirname(value))]
}
