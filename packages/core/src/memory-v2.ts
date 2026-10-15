export * as MemoryV2 from "./memory-v2"

import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, mkdir, open, realpath, rename, rm, unlink } from "node:fs/promises"
import path from "node:path"
import { MemoryFilesystem } from "./memory-filesystem"

export type Location = { home: string; directory: string; projectID?: string; scope?: "global" | "workspace" }
export type Root = { home: string; path: string; scope: "global" | "workspace"; locks: string }

export function directory(input: Location) {
  const identity = input.projectID && input.projectID !== "global" ? input.projectID : path.resolve(input.directory)
  return path.join(
    input.home,
    ".grok",
    "memory-v2",
    // Keep Apexo's journal and manifest separate from an installed Grok client.
    // The two runtimes do not have interchangeable SQLite schemas.
    "apexo",
    ...(input.scope === "global" ? ["global"] : ["workspaces", hash(identity).slice(0, 24)]),
  )
}

/** Inspect an existing scope without creating directories or a database. */
export async function inspect(input: Location): Promise<Root | undefined> {
  const home = await realpath(input.home)
  const root = {
    home,
    path: directory({ ...input, home }),
    scope: input.scope ?? "workspace",
    locks: path.join(home, ".grok", "memory-v2", "apexo", ".locks"),
  }
  await MemoryFilesystem.requireLocal(root.path)
  const segments = path.relative(home, root.path).split(path.sep)
  for (const [index] of segments.entries()) {
    const component = path.join(home, ...segments.slice(0, index + 1))
    const info = await lstat(component).catch(missing)
    if (!info) return undefined
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(component)) !== component)
      throw new Error("Invalid memory-v2 directory")
  }
  await validate(root, "memory_state.sqlite")
  return root
}

export async function initialize(input: Location): Promise<Root> {
  const home = await realpath(input.home)
  const root = {
    home,
    path: directory({ ...input, home }),
    scope: input.scope ?? "workspace",
    locks: path.join(home, ".grok", "memory-v2", "apexo", ".locks"),
  }
  await MemoryFilesystem.requireLocal(root.path)
  await MemoryFilesystem.requireLocal(root.locks)
  // Validate each existing ancestor before creating anything through it.
  for (const target of [
    root.path,
    root.locks,
    ...["topics", "observations/_inbox", "archive"].map((p) => path.join(root.path, p)),
  ]) {
    const segments = path.relative(home, target).split(path.sep)
    for (const [index] of segments.entries()) {
      const component = path.join(home, ...segments.slice(0, index + 1))
      const info = await lstat(component).catch(missing)
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Invalid memory-v2 directory")
      if (!info)
        await mkdir(component, { mode: 0o700 }).catch(async (error: unknown) => {
          if (!isCode(error, "EEXIST")) throw error
          if (!(await lstat(component)).isDirectory()) throw error
        })
      if ((await realpath(component)) !== component) throw new Error("Memory-v2 directory was redirected")
    }
  }
  await validate(root, "memory_state.sqlite")
  await validate(root, "memory_state.sqlite-wal")
  await validate(root, "memory_state.sqlite-shm")
  await validate(root, "MEMORY.md")
  return root
}

export async function validate(root: Root, relative: string) {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.startsWith("/") ||
    relative.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Invalid memory-v2 relative path")
  if ((await realpath(root.path)) !== root.path) throw new Error("Memory-v2 scope was redirected")
  const segments = relative.split("/")
  for (const [index] of segments.entries()) {
    const target = path.join(root.path, ...segments.slice(0, index + 1))
    const info = await lstat(target).catch(missing)
    if (info?.isSymbolicLink() || (info && index < segments.length - 1 && !info.isDirectory()))
      throw new Error("Memory-v2 paths must not contain symbolic links")
    if (info && index === segments.length - 1 && !info.isFile()) throw new Error("Invalid memory-v2 file")
  }
  return path.join(root.path, ...segments)
}

export async function read(root: Root, relative: string, limit = 64 * 1024) {
  const value = await preview(root, relative, limit)
  if (value?.truncated) throw new Error("Memory-v2 file exceeds its read limit")
  return value?.content
}

export async function preview(root: Root, relative: string, limit = 256 * 1024) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 2 * 1024 * 1024)
    throw new Error("Invalid memory-v2 read limit")
  const target = await validate(root, relative)
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(missing)
  if (!handle) return undefined
  await using file = handle
  const before = await file.stat()
  if (!before.isFile()) throw new Error("Invalid memory-v2 file")
  const buffer = Buffer.alloc(Math.min(limit + 1, before.size + 1))
  let length = 0
  while (length < buffer.length) {
    const result = await file.read(buffer, length, buffer.length - length, length)
    if (!result.bytesRead) break
    length += result.bytesRead
  }
  const truncated = length > limit || before.size > limit
  const bytes = buffer.subarray(0, Math.min(length, limit))
  const after = await lstat(target)
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new Error("Memory-v2 file changed while reading")
  await validate(root, relative)
  return {
    content: new TextDecoder().decode(bytes, { stream: truncated }),
    hash: truncated ? null : hash(bytes),
    truncated,
    size: before.size,
    modified: before.mtimeMs,
  }
}

// Clearing user-authored notes must not inherit the preview size limit. Hash a
// stable file snapshot in bounded chunks, without decoding or retaining its body.
export async function fingerprint(root: Root, relative: string) {
  const target = await validate(root, relative)
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(missing)
  if (!handle) return undefined
  await using file = handle
  const before = await file.stat({ bigint: true })
  if (!before.isFile()) throw new Error("Invalid memory-v2 file")
  const digest = createHash("sha256")
  const buffer = Buffer.alloc(64 * 1024)
  let remaining = before.size
  while (remaining > 0n) {
    const result = await file.read(
      buffer,
      0,
      Number(remaining < BigInt(buffer.length) ? remaining : BigInt(buffer.length)),
      null,
    )
    if (!result.bytesRead) break
    digest.update(buffer.subarray(0, result.bytesRead))
    remaining -= BigInt(result.bytesRead)
  }
  const after = await lstat(target, { bigint: true })
  if (
    remaining !== 0n ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new Error("Memory-v2 file changed while hashing")
  await validate(root, relative)
  return { hash: digest.digest("hex"), size: Number(before.size) }
}

export async function remove(root: Root, relative: string, expected: string) {
  const target = await validate(root, relative)
  const before = await lstat(target, { bigint: true }).catch(missing)
  if (!before) return
  const value = await fingerprint(root, relative)
  if (!value || value.hash !== expected) throw new Error("Memory-v2 deletion evidence changed")
  const after = await lstat(target, { bigint: true })
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw new Error("Memory-v2 file changed before deletion")
  await validate(root, relative)
  await unlink(target)
  if (process.platform !== "win32") {
    await using folder = await open(path.dirname(target), "r")
    await folder.sync()
  }
}

// Immutable files are published with link(), so a crash cannot expose a partial
// final file and a concurrent/manual write is never overwritten by a retry.
export async function publish(
  root: Root,
  relative: string,
  content: string,
  immutable: boolean,
  expected?: string | null,
) {
  const target = await validate(root, relative)
  const before = expected !== undefined ? await lstat(target, { bigint: true }).catch(missing) : undefined
  const previous = await fingerprint(root, relative)
  if (previous?.hash === hash(content)) return
  if (expected !== undefined && (previous?.hash ?? null) !== expected)
    throw new Error("Memory-v2 publication evidence changed")
  if (immutable && previous !== undefined) throw new Error("Memory-v2 immutable file already has different content")
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await using file = await open(temporary, "wx", 0o600)
    await file.writeFile(content)
    await file.sync()
    await validate(root, relative)
    if (expected !== undefined) {
      const current = await lstat(target, { bigint: true }).catch(missing)
      if (
        before?.ino !== current?.ino ||
        before?.dev !== current?.dev ||
        before?.size !== current?.size ||
        before?.mtimeNs !== current?.mtimeNs ||
        before?.ctimeNs !== current?.ctimeNs
      )
        throw new Error("Memory-v2 file changed before publication")
    }
    await (immutable ? link(temporary, target) : rename(temporary, target))
  } finally {
    await rm(temporary, { force: true })
  }
  if (process.platform !== "win32") {
    await using folder = await open(path.dirname(target), "r")
    await folder.sync()
  }
}

export function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

export function safeSession(value: string) {
  return `${value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}-${hash(value).slice(0, 12)}`
}

function isCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function missing(error: unknown) {
  if (isCode(error, "ENOENT")) return undefined
  throw error
}
