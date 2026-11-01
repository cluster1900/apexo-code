import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Global } from "@apexo/core/global"
import { Slug } from "@apexo/core/util/slug"
import { Option, Schema } from "effect"
import { CliError } from "./effect-cmd"

export const ATTEMPTS_MANIFEST_FILENAME = "manifest.json"

export const AttemptsManifestItem = Schema.Struct({
  attempt: Schema.Int,
  status: Schema.Literals(["completed", "failed", "interrupted"]),
  sessionID: Schema.optional(Schema.String),
  worktreeRoot: Schema.String,
  directory: Schema.String,
  changedFiles: Schema.Array(Schema.String),
  diffStat: Schema.String,
  error: Schema.optional(Schema.String),
})
export type AttemptsManifestItem = Schema.Schema.Type<typeof AttemptsManifestItem>

export const AttemptsBatchManifest = Schema.Struct({
  version: Schema.Literal(1),
  batchID: Schema.String,
  createdAt: Schema.Number,
  sourceWorktree: Schema.String,
  sourceDirectory: Schema.String,
  headCommit: Schema.String,
  baselineTree: Schema.String,
  winnerAttempt: Schema.optional(Schema.Int),
  attempts: Schema.Array(AttemptsManifestItem),
})
export type AttemptsBatchManifest = Schema.Schema.Type<typeof AttemptsBatchManifest>

export const SavedAttemptsReport = Schema.Struct({
  type: Schema.Literal("attempts.result"),
  sourceDirectory: Schema.String,
  batchDirectory: Schema.optional(Schema.String),
  winnerAttempt: Schema.optional(Schema.Int),
  attempts: Schema.Array(
    Schema.Struct({
      attempt: Schema.Int,
      status: Schema.Literals(["completed", "failed", "interrupted"]),
      sessionID: Schema.optional(Schema.String),
      directory: Schema.String,
      worktreeReplacedOnExit: Schema.Boolean,
      changedFiles: Schema.Array(Schema.String),
      diffStat: Schema.String,
      error: Schema.optional(Schema.String),
    }),
  ),
})
export type SavedAttemptsReport = Schema.Schema.Type<typeof SavedAttemptsReport>

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeManifest = Schema.decodeUnknownOption(AttemptsBatchManifest)
const decodeSavedReport = Schema.decodeUnknownOption(SavedAttemptsReport)

export function attemptsBaseDirectory() {
  return path.join(Global.make().data, "worktree", "attempts")
}

export function selectWinnerAttempt(
  items: ReadonlyArray<{
    readonly attempt: number
    readonly status: string
    readonly changedFiles: ReadonlyArray<string>
  }>,
): number | undefined {
  return (
    items.find((item) => item.status === "completed" && item.changedFiles.length > 0)?.attempt ??
    items.find((item) => item.status === "completed")?.attempt
  )
}

function runGitSync(cwd: string, args: ReadonlyArray<string>, extraEnv?: Record<string, string>) {
  return Bun.spawnSync(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  })
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

export async function captureWorktreeTree(worktreeRoot: string): Promise<string> {
  const tempIndex = path.join(tmpdir(), `apexo-git-idx-${process.pid}-${Date.now()}-${Slug.create()}`)
  try {
    const readTree = runGitSync(worktreeRoot, ["read-tree", "HEAD"], { GIT_INDEX_FILE: tempIndex })
    if (readTree.exitCode !== 0) {
      throw new CliError({
        message: `Failed to read HEAD tree in ${worktreeRoot}: ${decodeText(readTree.stderr).trim()}`,
      })
    }
    const addAll = runGitSync(worktreeRoot, ["add", "-A"], { GIT_INDEX_FILE: tempIndex })
    if (addAll.exitCode !== 0) {
      throw new CliError({
        message: `Failed to stage worktree snapshot in ${worktreeRoot}: ${decodeText(addAll.stderr).trim()}`,
      })
    }
    const writeTree = runGitSync(worktreeRoot, ["write-tree"], { GIT_INDEX_FILE: tempIndex })
    const tree = decodeText(writeTree.stdout).trim()
    if (writeTree.exitCode !== 0 || !tree) {
      throw new CliError({
        message: `Failed to write worktree tree in ${worktreeRoot}: ${decodeText(writeTree.stderr).trim()}`,
      })
    }
    return tree
  } finally {
    await rm(tempIndex, { force: true }).catch(() => undefined)
  }
}

export function resolveHeadTree(worktreeRoot: string): string {
  const result = runGitSync(worktreeRoot, ["rev-parse", "--verify", "HEAD^{tree}"])
  const tree = decodeText(result.stdout).trim()
  if (result.exitCode !== 0 || !tree) {
    throw new CliError({
      message: `Failed to resolve HEAD tree in ${worktreeRoot}: ${decodeText(result.stderr).trim()}`,
    })
  }
  return tree
}

export function diffTreesPatch(
  repoRoot: string,
  fromTree: string,
  toTree: string,
): {
  readonly patch: Uint8Array
  readonly changedFiles: string[]
  readonly diffStat: string
} {
  if (fromTree === toTree) {
    return { patch: new Uint8Array(), changedFiles: [], diffStat: "" }
  }
  const namesProc = runGitSync(repoRoot, ["diff", "--no-renames", "--name-only", fromTree, toTree])
  if (namesProc.exitCode !== 0) {
    throw new CliError({
      message: `Failed to inspect candidate diff (${fromTree}..${toTree}): ${decodeText(namesProc.stderr).trim()}`,
    })
  }
  const changedFiles = decodeText(namesProc.stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (changedFiles.length === 0) {
    return { patch: new Uint8Array(), changedFiles: [], diffStat: "" }
  }
  const statProc = runGitSync(repoRoot, ["diff", "--stat", fromTree, toTree])
  const patchProc = runGitSync(repoRoot, ["diff", "--binary", "--full-index", fromTree, toTree])
  if (patchProc.exitCode !== 0) {
    throw new CliError({
      message: `Failed to generate candidate patch: ${decodeText(patchProc.stderr).trim()}`,
    })
  }
  return {
    patch: patchProc.stdout,
    changedFiles,
    diffStat: decodeText(statProc.stdout).trimEnd(),
  }
}

export async function writeAttemptsManifest(batchDirectory: string, manifest: AttemptsBatchManifest): Promise<string> {
  await mkdir(batchDirectory, { recursive: true })
  const manifestPath = path.join(batchDirectory, ATTEMPTS_MANIFEST_FILENAME)
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  return manifestPath
}

export async function readAttemptsManifest(manifestPath: string): Promise<AttemptsBatchManifest | undefined> {
  const file = Bun.file(manifestPath)
  if (!(await file.exists())) return undefined
  const parsed = decodeJson(await file.text())
  if (Option.isNone(parsed)) return undefined
  const manifest = decodeManifest(parsed.value)
  return Option.isSome(manifest) ? manifest.value : undefined
}

export async function readSavedAttemptsReport(filePath: string): Promise<SavedAttemptsReport | undefined> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return undefined
  const parsed = decodeJson(await file.text())
  if (Option.isNone(parsed)) return undefined
  const report = decodeSavedReport(parsed.value)
  return Option.isSome(report) ? report.value : undefined
}

async function canonicalPathSafe(target: string): Promise<string> {
  return realpath(target).catch(() => path.resolve(target))
}

export async function pathStatSafe(target: string) {
  return stat(target).catch(() => undefined)
}

export async function findLatestAttemptsBatch(sourceWorktree: string): Promise<
  | {
      readonly batchDirectory: string
      readonly manifest: AttemptsBatchManifest
    }
  | undefined
> {
  const root = attemptsBaseDirectory()
  const rootInfo = await pathStatSafe(root)
  if (!rootInfo?.isDirectory()) return undefined
  const canonicalSource = await canonicalPathSafe(sourceWorktree)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const loaded = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const batchDirectory = path.join(root, entry.name)
        const manifest = await readAttemptsManifest(path.join(batchDirectory, ATTEMPTS_MANIFEST_FILENAME))
        if (!manifest) return undefined
        const manifestSource = await canonicalPathSafe(manifest.sourceWorktree)
        if (manifestSource !== canonicalSource) return undefined
        return { batchDirectory, manifest }
      }),
  )
  return loaded
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .toSorted((left, right) => right.manifest.createdAt - left.manifest.createdAt)[0]
}
