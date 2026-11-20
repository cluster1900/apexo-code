import {
  accessSync,
  constants,
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

const stagingPath = (directory: string) =>
  path.join(path.dirname(directory), `.${path.basename(directory)}.directory-migration`)

function pointsToDirectory(link: string, directory: string) {
  return !path.relative(
    path.toNamespacedPath(directory),
    path.toNamespacedPath(path.resolve(path.dirname(link), readlinkSync(link))),
  )
}

export async function migrateAppDirectory(base: string, name: string, oldName: string) {
  const directory = path.join(base, name)
  const legacy = path.join(base, oldName)
  const staged = stagingPath(directory)
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
  try {
    if (!canMove() && !lstatSync(staged, { throwIfNoEntry: false })) return directory

    await using lock = await Flock.acquire(`directory:${name}`, {
      dir: path.join(base, ".apexo-migration-locks"),
      reclaimDeadOwner: true,
    })
    const link = lstatSync(staged, { throwIfNoEntry: false })
    if (link && (!link.isSymbolicLink() || !pointsToDirectory(staged, directory)))
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
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error.code !== "EACCES" && error.code !== "EPERM" && error.code !== "EROFS")
    )
      throw error

    // The move may have completed before publishing the alias failed. Keep using the directory that owns the data.
    const available = canMove() ? legacy : directory
    if (!statSync(available, { throwIfNoEntry: false })?.isDirectory()) throw error
    accessSync(available, constants.R_OK | constants.X_OK)
    return available
  }
}

export function migratedAppDirectoryAliases(directory: string) {
  if (path.basename(directory) !== APP_DIR_NAME) return
  const base = path.dirname(directory)
  const legacy = path.join(base, LEGACY_APP_DIR_NAME)
  try {
    const previous = lstatSync(legacy, { throwIfNoEntry: false })
    // An interrupted move can leave the old spelling recorded only in the staged alias.
    const link = previous ? legacy : stagingPath(directory)
    if (!(previous ?? lstatSync(link, { throwIfNoEntry: false }))?.isSymbolicLink()) return
    if (!previous && !pointsToDirectory(link, directory)) return
    const resolved = realpathSync(directory)
    if (realpathSync(link) !== resolved) return

    // The XDG base itself can be a symlink, while persisted paths may already have been resolved.
    return {
      current: [...new Set([directory, resolved])],
      legacy: [...new Set([legacy, path.join(realpathSync(base), LEGACY_APP_DIR_NAME)])],
      staged: !previous,
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
  return migratedWorktreeAliases(data, directory)?.paths ?? [directory]
}

export function verifiedMigratedWorktreePaths(data: string, directory: string, options?: { liveOnly?: boolean }) {
  const worktree = migratedWorktreeAliases(data, directory)
  if (!worktree) return []
  const live = worktree.paths.filter((candidate) => {
    try {
      return realpathSync(candidate) === worktree.directory
    } catch {
      return false
    }
  })
  if (!live.length || options?.liveOnly) return live
  // An unpublished legacy alias is still relevant when looking up stored state.
  return [...new Set([...live, ...worktree.stagedPaths])]
}

function containedRelative(directory: string, target: string) {
  const relative = path.relative(directory, target)
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) return relative
}

export function existingAncestor(target: string) {
  try {
    const normalized = path.normalize(target)
    const root = path.parse(normalized).root
    for (let candidate = normalized; candidate !== root; candidate = path.dirname(candidate)) {
      if (lstatSync(candidate, { throwIfNoEntry: false })) return candidate
    }
  } catch {
    return
  }
}

export function worktreeRelativePath(data: string, directory: string, target: string) {
  return (
    containedRelative(directory, target) ??
    verifiedMigratedWorktreePaths(data, directory, { liveOnly: true })
      .map((alias) => containedRelative(alias, target))
      .find((relative) => relative !== undefined)
  )
}

export function migratedWorktreeAliases(data: string, directory: string) {
  if (!path.isAbsolute(directory)) return
  const aliases = migratedAppDirectoryAliases(
    path.basename(data) === LEGACY_APP_DIR_NAME ? path.join(path.dirname(data), APP_DIR_NAME) : data,
  )
  if (!aliases) return
  const roots = [...aliases.current, ...aliases.legacy].map((root) => path.join(root, "worktree"))
  const relative = roots.map((root) => containedRelative(root, directory)).find((suffix) => suffix !== undefined)
  if (relative === undefined) return
  const canonicalData = aliases.current.at(-1)!
  return {
    data: canonicalData,
    directory: path.join(canonicalData, "worktree", relative),
    paths: [...new Set([directory, ...roots.map((root) => path.join(root, relative))])],
    stagedPaths: aliases.staged ? aliases.legacy.map((root) => path.join(root, "worktree", relative)) : [],
  }
}
