export * as WorkspaceMemory from "./workspace-memory"

import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { Global } from "./global"
import { Flock } from "./util/flock"
import { MemoryMaintenance } from "./memory-maintenance"

export class MigrationRequired extends Error {}

const MigrationReceipt = Schema.Struct({
  sourceHash: Schema.String,
  targetHash: Schema.String,
  generation: Schema.Literal("initial"),
  publishedHash: Schema.String,
})

export type Scope = "global" | "workspace"

export type Location = {
  projectID?: string
  scope?: Scope
}

export function file(directory: string, home = Global.Path.home, location: Location = {}) {
  if (location.scope === "global") return path.join(home, ".grok", "memory", "MEMORY.md")
  // Project IDs already normalize remote transport and share identity across clones/worktrees.
  // The global project ID represents unrelated non-Git directories, not one memory scope.
  if (location.projectID && location.projectID !== "global")
    return path.join(
      home,
      ".grok",
      "memory",
      `project-${createHash("sha256").update(location.projectID).digest("hex").slice(0, 24)}`,
      "MEMORY.md",
    )
  const resolved = path.resolve(directory)
  const name = `${path.basename(resolved).replace(/[^a-zA-Z0-9._-]/g, "-") || "workspace"}-${createHash("sha256").update(resolved).digest("hex").slice(0, 8)}`
  return path.join(home, ".grok", "memory", name, "MEMORY.md")
}

export async function read(directory: string, home = Global.Path.home, location: Location = {}) {
  await MemoryMaintenance.revision(maintenance(directory, home, location))
  await migrate(directory, home, location)
  return contents(file(directory, home, location))
}

export function maintenance(directory: string, home = Global.Path.home, location: Location = {}) {
  return { home, root: path.dirname(file(directory, home, location)) }
}

export async function context(directory: string, home = Global.Path.home, location: Location = {}) {
  const notes = await Promise.all(
    (["global", "workspace"] as const).map(async (scope) => ({
      scope,
      path: file(directory, home, { ...location, scope }),
      content: await read(directory, home, { ...location, scope }),
    })),
  )
  return notes.filter((note) => note.content.trim())
}

export async function update(
  directory: string,
  input: { operation: "remember" | "flush"; content?: string; scope?: Scope },
  home = Global.Path.home,
  location: Location = {},
  options: { generation?: string; migrate?: boolean } = {},
) {
  const selected = { ...location, scope: input.scope ?? location.scope }
  if (options.migrate !== false) await migrate(directory, home, selected)
  const target = file(directory, home, selected)
  return MemoryMaintenance.write(
    maintenance(directory, home, selected),
    () =>
      Flock.withLock(
        target,
        async () => {
          const canonicalHome = options.migrate === false ? await realpath(home) : undefined
          const selectedTarget = canonicalHome
            ? path.join(canonicalHome, path.relative(path.resolve(home), target))
            : target
          if (canonicalHome) {
            await validateMigrationPaths(canonicalHome, [selectedTarget])
            const legacy = file(directory, home)
            const marker = path.join(
              path.dirname(target),
              ".migrated",
              createHash("sha256").update(legacy).digest("hex"),
            )
            if (selected.scope !== "global" && legacy !== target && (await exists(legacy)) && !(await exists(marker)))
              throw new MigrationRequired(
                "Older workspace notes require explicit migration before remembering new notes",
              )
          }
          const current = options.migrate === false ? await readMigrationFile(selectedTarget) : await contents(target)
          const content = input.content?.trim()
          if (!content) throw new Error(`${input.operation} requires a non-empty note or summary`)
          const next = consolidate(`${current.trim() || "# Memory"}\n\n- ${new Date().toISOString()} — ${content}\n`)
          await save(selectedTarget, next)
          return next
        },
        { dir: path.join(home, ".grok", "memory", ".locks") },
      ),
    options.generation,
  )
}

export async function migrationSnapshot(directory: string, home: string, location: Location, relocation: boolean) {
  const canonicalHome = await realpath(home)
  const source = file(directory, canonicalHome, relocation ? {} : location)
  const target = file(directory, canonicalHome, location)
  await validateMigrationPaths(canonicalHome, [source, target])
  const content = await readMigrationFile(source, 256 * 1024)
  const current = relocation ? await readMigrationFile(target, 512 * 1024) : ""
  return {
    source,
    target,
    content,
    sourceHash: createHash("sha256").update(content).digest("hex"),
    targetHash: createHash("sha256").update(current).digest("hex"),
    generation: await MemoryMaintenance.inspect(maintenance(directory, canonicalHome, location)),
  }
}

export async function migrate(
  directory: string,
  home: string,
  location: Location,
  authorize?: (paths: { read: string[]; edit: string[] }) => boolean,
  expected?: { sourceHash: string; targetHash: string; generation: string },
) {
  if (location.scope === "global") return
  const legacy = file(directory, home)
  const target = file(directory, home, location)
  if (legacy === target) return
  if ((await MemoryMaintenance.revision(maintenance(directory, home, location))) !== "initial") {
    if (expected) throw new Error("Legacy memory generation changed")
    return
  }
  const marker = path.join(path.dirname(target), ".migrated", createHash("sha256").update(legacy).digest("hex"))
  if (await exists(marker)) return
  if (!(await exists(legacy))) return
  const canonicalHome = authorize ? await realpath(home) : home
  const pending = `${marker}.pending`
  if (!expected && (await exists(pending))) throw new MigrationRequired("Explicit memory relocation is pending")
  const canonical = [legacy, target, marker, pending].map((file) => path.join(canonicalHome, path.relative(home, file)))
  if (
    authorize &&
    !authorize({ read: [legacy, target, ...canonical.slice(0, 2)], edit: [target, marker, ...canonical.slice(1)] })
  )
    return
  await MemoryMaintenance.write(
    maintenance(directory, home, location),
    () =>
      Flock.withLock(
        target,
        async () => {
          if (await exists(marker)) return
          if (authorize) await validateMigrationPaths(canonicalHome, canonical)
          const previous = authorize ? await readMigrationFile(canonical[0]!) : await contents(legacy)
          if (!previous.trim()) return
          const current = authorize ? await readMigrationFile(canonical[1]!) : await contents(target)
          const sourceHash = createHash("sha256").update(previous).digest("hex")
          const targetHash = createHash("sha256").update(current).digest("hex")
          const content = consolidate(
            `${current.trim() || "# Memory"}\n\n${previous.replace(/^# Memory\r?\n/, "").trim()}`,
          )
          if (expected) {
            if (expected.generation !== "initial" || sourceHash !== expected.sourceHash)
              throw new Error("Legacy memory migration preview changed")
            const saved = await readMigrationFile(canonical[3]!, 4096)
            const receipt = saved ? Schema.decodeUnknownSync(Schema.fromJsonString(MigrationReceipt))(saved) : undefined
            if (
              receipt &&
              (receipt.sourceHash !== expected.sourceHash ||
                receipt.targetHash !== expected.targetHash ||
                receipt.generation !== expected.generation)
            )
              throw new Error("Another legacy memory relocation is pending")
            if (receipt && targetHash === receipt.publishedHash) {
              // The target rename settled before the host stopped. Only the exact
              // prepared receipt may finish its marker without writing notes again.
              await save(marker, JSON.stringify(receipt))
              await rm(pending, { force: true })
              return
            }
            if (targetHash !== expected.targetHash) throw new Error("Legacy memory migration target changed")
            const publishedHash = createHash("sha256").update(content).digest("hex")
            if (receipt && receipt.publishedHash !== publishedHash)
              throw new Error("Legacy memory relocation receipt changed")
            const prepared = { ...expected, publishedHash }
            await save(pending, JSON.stringify(prepared))
            await save(target, content)
            await save(marker, JSON.stringify(prepared))
            await rm(pending, { force: true })
            return
          }
          // Compatibility migration keeps its existing semantics. A pending
          // explicitly owned relocation is never adopted by an implicit read.
          if (await exists(pending)) throw new MigrationRequired("Explicit memory relocation is pending")
          await save(target, content)
          await save(marker, "imported\n")
        },
        { dir: path.join(home, ".grok", "memory", ".locks"), deadOwnerOnly: Boolean(expected) },
      ),
    "initial",
    expected ? "explicit" : undefined,
  )
}

// Automatic migration must not follow a legacy note or parent directory outside
// the authorized memory paths. macOS /var aliases are resolved from home first.
async function validateMigrationPaths(home: string, files: string[]) {
  const paths = [
    ...new Set(
      files.flatMap((file) => {
        const relative = path.relative(home, file)
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid memory migration path")
        const segments = relative.split(path.sep)
        return segments.map((_, index) => path.join(home, ...segments.slice(0, index + 1)))
      }),
    ),
  ]
  await Promise.all(
    paths.map(async (file) => {
      const info = await lstat(file).catch((error: unknown) => {
        if (missing(error)) return
        throw error
      })
      if (info?.isSymbolicLink()) throw new Error("Memory migration symlinks are not allowed")
    }),
  )
}

async function readMigrationFile(file: string, limit = 512 * 1024) {
  const info = await lstat(file).catch((error: unknown) => {
    if (missing(error)) return
    throw error
  })
  if (!info) return ""
  if (!info.isFile() || (await realpath(file)) !== file) throw new Error("Invalid memory migration source")
  await using handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const opened = await handle.stat()
  if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev)
    throw new Error("Memory migration source changed")
  if (opened.size > limit) throw new Error("Memory migration source exceeds its byte bound")
  const bytes = Buffer.alloc(limit + 1)
  let size = 0
  while (size < bytes.length) {
    const read = await handle.read(bytes, size, bytes.length - size, size)
    if (!read.bytesRead) break
    size += read.bytesRead
  }
  if (size > limit || size !== opened.size) throw new Error("Memory migration source exceeds its bound or changed")
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))
  const after = await lstat(file)
  if (
    after.ino !== opened.ino ||
    after.dev !== opened.dev ||
    after.size !== opened.size ||
    after.mtimeMs !== opened.mtimeMs ||
    after.ctimeMs !== opened.ctimeMs ||
    (await realpath(file)) !== file
  )
    throw new Error("Memory migration source changed")
  return content
}

async function save(target: string, content: string) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, target).catch(async (error: unknown) => {
    await rm(temporary, { force: true })
    throw error
  })
}

async function contents(target: string) {
  return readFile(target, "utf8").catch((error: unknown) => {
    if (missing(error)) return ""
    throw error
  })
}

async function exists(target: string) {
  return access(target).then(
    () => true,
    (error: unknown) => {
      if (missing(error)) return false
      throw error
    },
  )
}

function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

// Keep Markdown blocks intact. Timestamps do not make identical notes distinct.
function consolidate(text: string) {
  const seen = new Set<string>()
  const blocks = text
    .trim()
    .split(/\n(?=- \d{4}-\d\d-\d\dT)/)
    .filter((block) => {
      const key = block.replace(/^- \d{4}-\d\d-\d\dT\S+ — /, "").trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return `${blocks.join("\n").trim() || "# Memory"}\n`
}
