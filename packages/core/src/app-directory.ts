import {
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import path from "node:path"
import { LEGACY_APP_DIR_NAME } from "./legacy-compat"
import { Flock } from "./util/flock"

export const APP_DIR_NAME = "apexo"

export async function migrateAppDirectory(base: string, name: string, oldName: string) {
  const directory = path.join(base, name)
  const legacy = path.join(base, oldName)
  const staged = path.join(base, `.${name}.directory-migration`)
  const canMove = () => {
    const current = lstatSync(directory, { throwIfNoEntry: false })
    if (!current) return statSync(legacy, { throwIfNoEntry: false })?.isDirectory() === true
    if (!current.isDirectory() || !lstatSync(legacy, { throwIfNoEntry: false })?.isDirectory()) return false
    try {
      return readdirSync(directory).length === 0
    } catch (error) {
      // A concurrent Windows migration can remove the empty destination while we probe it.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return true
      throw error
    }
  }
  if (!canMove() && !lstatSync(staged, { throwIfNoEntry: false })) return directory

  await using lock = await Flock.acquire(`directory:${name}`, {
    dir: path.join(base, ".apexo-migration-locks"),
    reclaimDeadOwner: true,
  })
  const link = lstatSync(staged, { throwIfNoEntry: false })
  if (
    link &&
    (!link.isSymbolicLink() ||
      path.relative(path.toNamespacedPath(directory), path.toNamespacedPath(path.resolve(base, readlinkSync(staged)))))
  )
    throw new Error(`Unexpected Apexo directory migration entry: ${staged}`)

  if (!canMove()) {
    if (link) {
      if (lstatSync(directory, { throwIfNoEntry: false }) && !lstatSync(legacy, { throwIfNoEntry: false }))
        renameSync(staged, legacy)
      else unlinkSync(staged)
    }
    return directory
  }

  // Keep references saved with the old absolute path, including Git worktrees and SQLite sidecars.
  // A staged alias also allows recovery if startup stops between the two atomic renames.
  const windows = process.platform === "win32"
  if (!link) {
    symlinkSync(windows ? path.resolve(directory) : name, staged, windows ? "junction" : "dir")
  }
  if (windows && lstatSync(directory, { throwIfNoEntry: false })) rmdirSync(directory)
  renameSync(legacy, directory)
  renameSync(staged, legacy)
  return directory
}

export function migratedAppDirectoryAliases(directory: string) {
  if (path.basename(directory) !== APP_DIR_NAME) return
  const base = path.dirname(directory)
  const legacy = path.join(base, LEGACY_APP_DIR_NAME)
  try {
    if (!lstatSync(legacy, { throwIfNoEntry: false })?.isSymbolicLink()) return
    const resolved = realpathSync(directory)
    if (realpathSync(legacy) !== resolved) return

    // The XDG base itself can be a symlink, while persisted paths may already have been resolved.
    return {
      current: [...new Set([directory, resolved])],
      legacy: [...new Set([legacy, path.join(realpathSync(base), LEGACY_APP_DIR_NAME)])],
    }
  } catch {
    return
  }
}

export function resolveMigratedAppPath(
  file: string,
  aliases: NonNullable<ReturnType<typeof migratedAppDirectoryAliases>>,
  subdirectory: string,
) {
  if (!path.isAbsolute(file)) return file
  const relative = aliases.legacy
    .map((legacy) => path.relative(path.join(legacy, subdirectory), file))
    .find((suffix) => !path.isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${path.sep}`))
  return relative === undefined ? file : path.join(aliases.current[0], subdirectory, relative)
}

export function migratedWorktreePaths(data: string, directory: string) {
  if (!path.isAbsolute(directory)) return [directory]
  const aliases = migratedAppDirectoryAliases(data)
  if (!aliases) return [directory]
  const roots = [...aliases.current, ...aliases.legacy].map((root) => path.join(root, "worktree"))
  const relative = roots
    .map((root) => path.relative(root, directory))
    .find((suffix) => !path.isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${path.sep}`))
  if (relative === undefined) return [directory]
  return [...new Set([directory, ...roots.map((root) => path.join(root, relative))])]
}
