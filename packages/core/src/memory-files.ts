export * as MemoryFiles from "./memory-files"

import { constants } from "node:fs"
import { lstat, open, readdir, realpath } from "node:fs/promises"
import path from "node:path"

export type Root = { path: string; alias: string; source: "global" | "workspace" }
export type File = {
  path: string
  root: Root
  source: "global" | "workspace" | "session"
  signature: string
  size: number
  modified: number
}
const folders = new Set(["topics", "sessions", "observations"])

export async function list(roots: Root[]) {
  const walk = async (root: Root, directory: string): Promise<File[]> => {
    if ((await realpath(directory)) !== directory || !(await lstat(directory)).isDirectory()) return []
    const files = await readdir(directory, { withFileTypes: true })
    return (
      await Promise.all(
        files.map(async (entry): Promise<File[]> => {
          const target = path.join(directory, entry.name)
          if (entry.isSymbolicLink() || entry.name.startsWith(".")) return []
          if (entry.isDirectory()) {
            if (directory === root.path && !folders.has(entry.name)) return []
            return walk(root, target).catch((error: unknown) => {
              if (missing(error)) return []
              throw error
            })
          }
          if (!entry.isFile() || !allowed(root.path, target)) return []
          const info = await lstat(target, { bigint: true }).catch((error: unknown) => {
            if (missing(error)) return undefined
            throw error
          })
          if (!info?.isFile()) return []
          const source = ["sessions", "observations"].includes(path.relative(root.path, target).split(path.sep)[0]!)
            ? "session"
            : root.source
          return [
            {
              path: target,
              root,
              source,
              signature: `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
              size: Number(info.size),
              modified: Number(info.mtimeMs),
            },
          ]
        }),
      )
    ).flat()
  }
  return (
    await Promise.all(
      roots.map((root) =>
        walk(root, root.path).catch((error: unknown) => {
          if (missing(error)) return []
          throw error
        }),
      ),
    )
  ).flat()
}

export function allowed(root: string, target: string) {
  const relative = path.relative(root, target)
  if (!relative || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || relative === "..") return false
  const segments = relative.split(path.sep)
  return (
    target.endsWith(".md") &&
    (segments.length === 1 || folders.has(segments[0]!)) &&
    segments.every((segment) => !segment.startsWith("."))
  )
}

export async function read(target: string, root: Root, limit?: number) {
  if (!allowed(root.path, target) || (await realpath(target)) !== target)
    throw new Error("Memory file symlinks and out-of-scope paths are not allowed")
  await using file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const before = await file.stat({ bigint: true })
  if (!before.isFile()) throw new Error("Memory path is not a regular file")
  const bytes = limit === undefined ? await file.readFile() : await bounded(file, Math.min(Number(before.size), limit))
  const after = await lstat(target, { bigint: true })
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    (await realpath(target)) !== target
  )
    throw new Error("Memory file changed while being read; retry")
  return { bytes, size: Number(before.size), modified: Number(before.mtimeMs), identity: before }
}

async function bounded(file: Awaited<ReturnType<typeof open>>, size: number) {
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const result = await file.read(bytes, offset, size - offset, offset)
    if (!result.bytesRead) break
    offset += result.bytesRead
  }
  return bytes.subarray(0, offset)
}

export function missing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
