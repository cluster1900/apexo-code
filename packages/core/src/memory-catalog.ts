export * as MemoryCatalog from "./memory-catalog"

import { createHash } from "node:crypto"
import { lstat, realpath, unlink } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { MemoryNote } from "@apexo/schema/memory-note"
import { MemoryFiles } from "./memory-files"
import { MemoryMaintenance } from "./memory-maintenance"
import { WorkspaceMemory } from "./workspace-memory"

export class Error extends Schema.TaggedErrorClass<Error>()("MemoryCatalogError", {
  reason: Schema.Literals(["not_found", "not_deletable", "changed", "forbidden", "invalid", "failed"]),
  message: Schema.String,
}) {}

export type Location = {
  directory: string
  home: string
  projectID?: string
  migrate?: boolean
  permitted: (paths: readonly string[], action: "read" | "edit") => boolean
}
// Match the official forget limit; larger notes remain available for preview.
const limit = 256 * 1024

export async function list(input: Location, query = ""): Promise<MemoryNote.Summary[]> {
  if (input.migrate !== false)
    await WorkspaceMemory.migrate(
      input.directory,
      input.home,
      input,
      (paths) => input.permitted(paths.read, "read") && input.permitted(paths.edit, "edit"),
    )
  const roots = await scopes(input)
  const revisions = await Promise.all(
    roots.map((root) => MemoryMaintenance.revision({ home: input.home, root: root.alias })),
  )
  const terms = query.normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean)
  const notes = await Promise.all(
    (await MemoryFiles.list(roots)).map(async (file) => {
      if (!input.permitted(accessPaths(file.path, file.root), "read")) return
      if (terms.length) {
        const value = await MemoryFiles.read(file.path, file.root)
        const searchable = `${path.relative(file.root.path, file.path)}\n${value.bytes.toString("utf8")}`
          .normalize("NFKC")
          .toLowerCase()
        if (!terms.every((term) => searchable.includes(term))) return
      }
      return summary(input, file.path, file.root, file)
    }),
  )
  if (
    (await Promise.all(roots.map((root) => MemoryMaintenance.revision({ home: input.home, root: root.alias })))).some(
      (value, index) => value !== revisions[index],
    )
  )
    throw new Error({ reason: "changed", message: "Memory changed while listing; refresh the list" })
  const order = { global: 0, workspace: 1, session: 2 }
  return notes
    .filter((note) => note !== undefined)
    .sort(
      (a, b) =>
        order[a.source] - order[b.source] ||
        (a.source === "session" ? b.modified - a.modified : 0) ||
        a.name.localeCompare(b.name),
    )
}

export async function preview(input: Location, file: string): Promise<MemoryNote.Detail> {
  const selected = await resolve(input, file)
  const location = { home: input.home, root: selected.root.alias }
  const revision = await MemoryMaintenance.revision(location)
  const value = await MemoryFiles.read(selected.path, selected.root, limit).catch(notFound)
  if ((await MemoryMaintenance.revision(location)) !== revision)
    throw new Error({ reason: "changed", message: "Memory changed while reading; refresh the preview" })
  const truncated = value.size > value.bytes.length
  return {
    ...summary(input, selected.path, selected.root, value),
    // Streaming decode omits an incomplete UTF-8 tail at the preview boundary.
    content: new TextDecoder().decode(value.bytes, { stream: truncated }),
    hash: truncated ? null : createHash("sha256").update(value.bytes).digest("hex"),
    truncated,
  }
}

export async function forget(input: Location, request: MemoryNote.Forget) {
  const selected = await resolve(input, request.path)
  if (!input.permitted(accessPaths(selected.path, selected.root), "edit"))
    throw new Error({ reason: "forbidden", message: "Deleting this memory is not permitted" })
  return MemoryMaintenance.change({ home: input.home, root: selected.root.alias }, async () => {
    const value = await MemoryFiles.read(selected.path, selected.root, limit).catch(notFound)
    if (value.size > limit)
      throw new Error({
        reason: "changed",
        message: "Notes larger than 256 KiB cannot be deleted from the browser",
      })
    if (createHash("sha256").update(value.bytes).digest("hex") !== request.hash)
      throw new Error({ reason: "changed", message: "This note changed after preview; read it again before deleting" })
    return async () => {
      const current = await lstat(selected.path, { bigint: true }).catch(notFound)
      if (
        !current.isFile() ||
        current.ino !== value.identity.ino ||
        current.dev !== value.identity.dev ||
        current.size !== value.identity.size ||
        current.mtimeNs !== value.identity.mtimeNs ||
        current.ctimeNs !== value.identity.ctimeNs ||
        (await realpath(selected.path)) !== selected.path
      )
        throw new Error({ reason: "changed", message: "This note changed before deletion; refresh the preview" })
      await unlink(selected.path)
      return true
    }
  })
}

async function scopes(input: Location): Promise<MemoryFiles.Root[]> {
  const home = await realpath(input.home)
  return Promise.all(
    (["global", "workspace"] as const).map(async (scope) => {
      const location = WorkspaceMemory.maintenance(input.directory, input.home, { ...input, scope })
      await MemoryMaintenance.revision(location)
      return {
        path: path.join(home, path.relative(path.resolve(input.home), location.root)),
        alias: location.root,
        source: scope,
      }
    }),
  )
}

async function resolve(input: Location, file: string) {
  const target = path.resolve(file.startsWith("~/") ? path.join(input.home, file.slice(2)) : file)
  const roots = await scopes(input)
  const root = roots.find((root) => MemoryFiles.allowed(root.path, target) || MemoryFiles.allowed(root.alias, target))
  if (!root) throw new Error({ reason: "forbidden", message: "Path is outside this repository's memory files" })
  const canonical = MemoryFiles.allowed(root.path, target)
    ? target
    : path.join(root.path, path.relative(root.alias, target))
  if (!input.permitted(accessPaths(canonical, root), "read"))
    throw new Error({ reason: "forbidden", message: "Reading this memory is not permitted" })
  return { path: canonical, root }
}

function accessPaths(file: string, root: MemoryFiles.Root) {
  return [file, path.join(root.alias, path.relative(root.path, file))]
}

function summary(
  input: Location,
  file: string,
  root: MemoryFiles.Root,
  info: { size: number; modified: number },
): MemoryNote.Summary {
  const name = path.relative(root.path, file)
  return {
    path: file,
    name,
    source: ["sessions", "observations"].includes(name.split(path.sep)[0]!) ? "session" : root.source,
    size: info.size,
    modified: info.modified,
    deletable: info.size <= limit && input.permitted(accessPaths(file, root), "edit"),
  }
}

function notFound(error: unknown): never {
  if (MemoryFiles.missing(error)) throw new Error({ reason: "not_found", message: "Memory note not found" })
  throw error
}
