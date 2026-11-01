import { realpath, rm } from "node:fs/promises"
import { EOL, tmpdir } from "node:os"
import path from "node:path"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { FSUtil } from "@apexo/core/fs-util"
import { Git } from "@apexo/core/git"
import { AbsolutePath } from "@apexo/core/schema"
import { Slug } from "@apexo/core/util/slug"
import { Effect, Option, Schema } from "effect"
import type { Argv } from "yargs"
import {
  ATTEMPTS_MANIFEST_FILENAME,
  captureWorktreeTree,
  diffTreesPatch,
  findLatestAttemptsBatch,
  pathStatSafe,
  readAttemptsManifest,
  readSavedAttemptsReport,
  resolveHeadTree,
  selectWinnerAttempt,
  type AttemptsBatchManifest,
  type AttemptsManifestItem,
} from "../attempts-worktree"
import { CliError } from "../effect-cmd"
import { nativeLocalDirectory } from "../native-local"
import { cmd } from "./cmd"

export interface ApplyReport {
  readonly type: "apply.result"
  readonly targetDirectory: string
  readonly sourceKind: "batch" | "worktree" | "patch"
  readonly sourcePath: string
  readonly batchDirectory?: string
  readonly attempt?: number
  readonly sessionID?: string
  readonly checkOnly: boolean
  readonly threeWay: boolean
  readonly index: boolean
  readonly clean: boolean
  readonly applied: boolean
  readonly cleanedUp: boolean
  readonly changedFiles: ReadonlyArray<string>
  readonly diffStat: string
  readonly error?: string
}

const gitRuntimeLayer = AppNodeBuilder.build(LayerNode.group([Git.node, FSUtil.node, CrossSpawnSpawner.node]))

function failApply(message: string): never {
  throw new CliError({ message })
}

function parseAttemptShorthand(raw: string): number | undefined {
  if (/^[1-9]\d*$/.test(raw)) return Number(raw)
  const match = /^attempt-([1-9]\d*)$/i.exec(raw)
  return match ? Number(match[1]) : undefined
}

function selectAttemptEntry(manifest: AttemptsBatchManifest, explicitAttempt?: number): AttemptsManifestItem {
  if (explicitAttempt !== undefined) {
    const found = manifest.attempts.find((item) => item.attempt === explicitAttempt)
    if (!found) {
      failApply(
        `Attempt ${explicitAttempt} does not exist in batch ${manifest.batchID} (available: 1..${manifest.attempts.length})`,
      )
    }
    return found
  }
  const winner = manifest.winnerAttempt ?? selectWinnerAttempt(manifest.attempts)
  if (winner === undefined) {
    failApply(
      `No completed attempt found in batch ${manifest.batchID}. Pass --attempt <n> explicitly to inspect or apply partial changes from a failed attempt.`,
    )
  }
  const selected = manifest.attempts.find((item) => item.attempt === winner)
  if (!selected) {
    failApply(`Selected attempt ${winner} was not found in batch ${manifest.batchID}`)
  }
  return selected
}

const decodeJsonString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String))

function unquotePatchHeaderPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed
  const decoded = decodeJsonString(trimmed)
  return Option.isSome(decoded) ? decoded.value : trimmed.slice(1, -1)
}

function parsePatchSummary(
  cwd: string,
  patchFile: string,
  patchBytes: Uint8Array,
): { changedFiles: string[]; diffStat: string } {
  const numstat = Bun.spawnSync(["git", "apply", "--numstat", "-z", "--", patchFile], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const statProc = Bun.spawnSync(["git", "apply", "--stat", "--", patchFile], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const decoder = new TextDecoder()
  const numstatPaths =
    numstat.exitCode === 0
      ? decoder
          .decode(numstat.stdout)
          .split("\0")
          .map((token) => (token.includes("\t") ? (token.split("\t")[2]?.trim() ?? "") : token.trim()))
          .filter(Boolean)
      : []
  const headerPaths = decoder
    .decode(patchBytes)
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line)
      return match?.[1] ? [unquotePatchHeaderPath(match[1])] : []
    })
    .filter(Boolean)
  return {
    changedFiles: [...new Set([...numstatPaths, ...headerPaths])].toSorted(),
    diffStat: statProc.exitCode === 0 ? decoder.decode(statProc.stdout).trimEnd() : "",
  }
}

function formatApplyReport(report: ApplyReport): string {
  const modeLabel = report.checkOnly ? "Preflight check passed" : "Applied changes cleanly"
  const attemptLabel = report.attempt !== undefined ? ` (attempt ${report.attempt})` : ""
  const lines = [
    `${modeLabel}${attemptLabel} -> ${report.targetDirectory}`,
    `Source:  ${report.sourcePath}`,
    `Changed: ${report.changedFiles.join(", ")}`,
  ]
  if (report.diffStat) lines.push(report.diffStat)
  if (report.cleanedUp) {
    lines.push(`Cleanup: removed candidate worktree${report.batchDirectory ? ` batch (${report.batchDirectory})` : ""}`)
  }
  return lines.join(EOL) + EOL
}

interface ResolvedCandidate {
  readonly sourceKind: "batch" | "worktree" | "patch"
  readonly sourcePath: string
  readonly batchDirectory?: string
  readonly manifest?: AttemptsBatchManifest
  readonly standaloneWorktreeRoot?: string
  readonly attempt?: number
  readonly sessionID?: string
  readonly patch: Uint8Array
  readonly changedFiles: ReadonlyArray<string>
  readonly diffStat: string
}

async function resolveWorktreeDiff(input: {
  readonly targetWorktree: string
  readonly worktreeRoot: string
  readonly baselineTree?: string
}): Promise<{ patch: Uint8Array; changedFiles: string[]; diffStat: string }> {
  const info = await pathStatSafe(input.worktreeRoot)
  if (!info?.isDirectory()) {
    failApply(`Candidate worktree ${input.worktreeRoot} no longer exists (it may have already been cleaned up)`)
  }
  const fromTree = input.baselineTree ?? resolveHeadTree(input.worktreeRoot)
  const toTree = await captureWorktreeTree(input.worktreeRoot)
  const diffRepo = input.baselineTree ? input.targetWorktree : input.worktreeRoot
  return diffTreesPatch(diffRepo, fromTree, toTree)
}

export const ApplyCommand = cmd({
  command: "apply [target]",
  describe: "apply changes from a parallel worktree attempt or patch file to the working tree",
  builder: (yargs: Argv) =>
    yargs
      .positional("target", {
        type: "string",
        describe:
          "attempt number (e.g. 2 or attempt-2), attempt/batch directory, attempts.result JSON file, or patch file",
      })
      .option("attempt", {
        alias: ["a"],
        type: "number",
        describe: "1-based attempt number to select from an attempts batch",
      })
      .option("dir", {
        type: "string",
        describe: "target repository directory to apply changes into",
      })
      .option("check", {
        alias: ["dry-run"],
        type: "boolean",
        default: false,
        describe: "verify that changes apply cleanly and preview diff stats without modifying files",
      })
      .option("3way", {
        type: "boolean",
        default: false,
        describe: "attempt a 3-way merge when target files have diverged",
      })
      .option("index", {
        type: "boolean",
        default: false,
        describe: "also apply changes to the Git index (stage applied changes)",
      })
      .option("cleanup", {
        type: "boolean",
        default: false,
        describe: "remove the candidate Git worktree(s) after a clean apply",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "emit structured JSON report",
      }),
  async handler(args) {
    const explicitAttempt = args.attempt
    if (explicitAttempt !== undefined && (!Number.isSafeInteger(explicitAttempt) || explicitAttempt < 1)) {
      failApply("--attempt must be a positive integer")
    }
    const checkOnly = Boolean(args.check)
    const threeWay = Boolean(args["3way"])
    const stageIndex = Boolean(args.index)
    const cleanup = Boolean(args.cleanup)
    const jsonOutput = Boolean(args.json)
    if (cleanup && checkOnly) {
      failApply("--cleanup cannot be combined with --check / --dry-run")
    }

    const callerCwd = path.resolve(process.env.PWD ?? process.cwd())
    const startDir = await nativeLocalDirectory(args.dir).catch((error) =>
      failApply(error instanceof Error ? error.message : String(error)),
    )

    const targetRepoInfo = await Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git.Service
        const fs = yield* FSUtil.Service
        const repo = yield* git.repo.discover(AbsolutePath.make(startDir))
        if (!repo) {
          return yield* Effect.fail(new CliError({ message: `apexo apply requires a Git repository (none found at ${startDir})` }))
        }
        const canonicalWorktree = yield* fs.resolve(repo.worktree)
        return { repo, canonicalWorktree }
      }).pipe(Effect.provide(gitRuntimeLayer)),
    )

    const resolveFromLatestBatch = async (attemptSelector?: number): Promise<ResolvedCandidate> => {
      const latest = await findLatestAttemptsBatch(targetRepoInfo.canonicalWorktree)
      if (!latest) {
        failApply(
          `No parallel attempts batch found for repository ${targetRepoInfo.canonicalWorktree}. Run "apexo run --attempts <n>" first or pass an explicit [target] path.`,
        )
      }
      const entry = selectAttemptEntry(latest.manifest, attemptSelector)
      const diff = await resolveWorktreeDiff({
        targetWorktree: targetRepoInfo.canonicalWorktree,
        worktreeRoot: entry.worktreeRoot,
        baselineTree: latest.manifest.baselineTree,
      })
      return {
        sourceKind: "batch",
        sourcePath: entry.worktreeRoot,
        batchDirectory: latest.batchDirectory,
        manifest: latest.manifest,
        attempt: entry.attempt,
        sessionID: entry.sessionID,
        ...diff,
      }
    }

    const candidate = await (async (): Promise<ResolvedCandidate> => {
      const rawTarget = args.target?.trim()
      if (!rawTarget) {
        return resolveFromLatestBatch(explicitAttempt)
      }

      const resolvedTargetPath = path.resolve(callerCwd, rawTarget)
      const targetStat = await pathStatSafe(resolvedTargetPath)
      if (!targetStat) {
        const shorthand = parseAttemptShorthand(rawTarget)
        if (shorthand !== undefined) {
          if (explicitAttempt !== undefined && explicitAttempt !== shorthand) {
            failApply(`Conflicting attempt selectors: positional "${rawTarget}" vs --attempt ${explicitAttempt}`)
          }
          return resolveFromLatestBatch(shorthand)
        }
        failApply(`Apply target not found: ${rawTarget}`)
      }

      if (targetStat.isDirectory()) {
        const canonicalDir = await realpath(resolvedTargetPath)
        const directManifest = await readAttemptsManifest(path.join(canonicalDir, ATTEMPTS_MANIFEST_FILENAME))
        if (directManifest) {
          const entry = selectAttemptEntry(directManifest, explicitAttempt)
          const diff = await resolveWorktreeDiff({
            targetWorktree: targetRepoInfo.canonicalWorktree,
            worktreeRoot: entry.worktreeRoot,
            baselineTree: directManifest.baselineTree,
          })
          return {
            sourceKind: "batch",
            sourcePath: entry.worktreeRoot,
            batchDirectory: canonicalDir,
            manifest: directManifest,
            attempt: entry.attempt,
            sessionID: entry.sessionID,
            ...diff,
          }
        }

        const standaloneRoot = await Effect.runPromise(
          Effect.gen(function* () {
            const git = yield* Git.Service
            const fs = yield* FSUtil.Service
            const repo = yield* git.repo.discover(AbsolutePath.make(canonicalDir))
            if (!repo) {
              return yield* Effect.fail(new CliError({ message: `Target directory is not a Git worktree: ${canonicalDir}` }))
            }
            return yield* fs.resolve(repo.worktree)
          }).pipe(Effect.provide(gitRuntimeLayer)),
        )

        const parentDir = path.dirname(standaloneRoot)
        const parentManifest = await readAttemptsManifest(path.join(parentDir, ATTEMPTS_MANIFEST_FILENAME))
        const matchedAttempt = parentManifest?.attempts.find(
          (item) => item.worktreeRoot === standaloneRoot || item.directory === canonicalDir,
        )
        if (parentManifest && matchedAttempt) {
          if (explicitAttempt !== undefined && explicitAttempt !== matchedAttempt.attempt) {
            failApply(
              `Target directory is attempt ${matchedAttempt.attempt}, which conflicts with --attempt ${explicitAttempt}`,
            )
          }
          const diff = await resolveWorktreeDiff({
            targetWorktree: targetRepoInfo.canonicalWorktree,
            worktreeRoot: matchedAttempt.worktreeRoot,
            baselineTree: parentManifest.baselineTree,
          })
          return {
            sourceKind: "worktree",
            sourcePath: matchedAttempt.worktreeRoot,
            batchDirectory: parentDir,
            manifest: parentManifest,
            attempt: matchedAttempt.attempt,
            sessionID: matchedAttempt.sessionID,
            ...diff,
          }
        }

        if (explicitAttempt !== undefined) {
          failApply("--attempt can only be used with an attempts batch or attempts.result report")
        }
        if (standaloneRoot === targetRepoInfo.canonicalWorktree) {
          failApply("Cannot apply the target working tree onto itself")
        }
        const diff = await resolveWorktreeDiff({
          targetWorktree: targetRepoInfo.canonicalWorktree,
          worktreeRoot: standaloneRoot,
        })
        return {
          sourceKind: "worktree",
          sourcePath: standaloneRoot,
          standaloneWorktreeRoot: standaloneRoot,
          ...diff,
        }
      }

      const canonicalFile = await realpath(resolvedTargetPath)
      const manifestFromFile = await readAttemptsManifest(canonicalFile)
      if (manifestFromFile) {
        const batchDirectory = path.dirname(canonicalFile)
        const entry = selectAttemptEntry(manifestFromFile, explicitAttempt)
        const diff = await resolveWorktreeDiff({
          targetWorktree: targetRepoInfo.canonicalWorktree,
          worktreeRoot: entry.worktreeRoot,
          baselineTree: manifestFromFile.baselineTree,
        })
        return {
          sourceKind: "batch",
          sourcePath: entry.worktreeRoot,
          batchDirectory,
          manifest: manifestFromFile,
          attempt: entry.attempt,
          sessionID: entry.sessionID,
          ...diff,
        }
      }

      const savedReport = await readSavedAttemptsReport(canonicalFile)
      if (savedReport) {
        const chosenAttempt =
          explicitAttempt ?? savedReport.winnerAttempt ?? selectWinnerAttempt(savedReport.attempts)
        if (chosenAttempt === undefined) {
          failApply("Saved attempts report has no completed attempt. Pass --attempt <n> explicitly.")
        }
        const reportEntry = savedReport.attempts.find((item) => item.attempt === chosenAttempt)
        if (!reportEntry) {
          failApply(`Attempt ${chosenAttempt} was not found in report ${rawTarget}`)
        }
        if (reportEntry.worktreeReplacedOnExit) {
          failApply(`Attempt ${chosenAttempt} ran with --ephemeral and its worktree was already removed on exit`)
        }
        const discoveredEntryRoot = await Effect.runPromise(
          Effect.gen(function* () {
            const git = yield* Git.Service
            const fs = yield* FSUtil.Service
            const repo = yield* git.repo
              .discover(AbsolutePath.make(reportEntry.directory))
              .pipe(Effect.catch(() => Effect.succeed(undefined)))
            return repo ? yield* fs.resolve(repo.worktree) : undefined
          }).pipe(Effect.provide(gitRuntimeLayer)),
        )
        const inferredBatchDir =
          savedReport.batchDirectory ?? path.dirname(discoveredEntryRoot ?? reportEntry.directory)
        const batchManifest = await readAttemptsManifest(path.join(inferredBatchDir, ATTEMPTS_MANIFEST_FILENAME))
        const manifestEntry = batchManifest?.attempts.find((item) => item.attempt === chosenAttempt)
        const worktreeRoot = manifestEntry?.worktreeRoot ?? discoveredEntryRoot ?? reportEntry.directory
        const diff = await resolveWorktreeDiff({
          targetWorktree: targetRepoInfo.canonicalWorktree,
          worktreeRoot,
          baselineTree: batchManifest?.baselineTree,
        })
        return {
          sourceKind: "batch",
          sourcePath: worktreeRoot,
          ...(batchManifest ? { batchDirectory: inferredBatchDir, manifest: batchManifest } : {}),
          attempt: chosenAttempt,
          sessionID: reportEntry.sessionID,
          ...diff,
        }
      }

      if (explicitAttempt !== undefined) {
        failApply("--attempt cannot be used when applying a patch file")
      }
      if (cleanup) {
        failApply("--cleanup cannot be used when applying a patch file")
      }
      const patchBytes = await Bun.file(canonicalFile).bytes()
      const summary = parsePatchSummary(targetRepoInfo.canonicalWorktree, canonicalFile, patchBytes)
      return {
        sourceKind: "patch",
        sourcePath: canonicalFile,
        patch: patchBytes,
        changedFiles: summary.changedFiles,
        diffStat: summary.diffStat,
      }
    })()

    if (candidate.patch.byteLength === 0 || (candidate.sourceKind !== "patch" && candidate.changedFiles.length === 0)) {
      failApply("Selected candidate produced no file changes to apply")
    }

    const tempPatch = path.join(tmpdir(), `apexo-apply-${process.pid}-${Date.now()}-${Slug.create()}.patch`)
    const tempIndex = threeWay
      ? path.join(tmpdir(), `apexo-apply-idx-${process.pid}-${Date.now()}-${Slug.create()}`)
      : undefined
    try {
      await Bun.write(tempPatch, candidate.patch)

      const runGitApply = async (): Promise<{ clean: boolean; stderrText: string }> => {
        if (!threeWay || !tempIndex) {
          const applyArgs = [
            "apply",
            ...(checkOnly ? ["--check"] : []),
            ...(stageIndex ? ["--index"] : []),
            "--",
            tempPatch,
          ]
          const res = Bun.spawnSync(["git", ...applyArgs], {
            cwd: targetRepoInfo.canonicalWorktree,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          })
          return {
            clean: res.exitCode === 0,
            stderrText: new TextDecoder().decode(res.stderr).trim(),
          }
        }

        // `git apply --3way` requires touched paths in the index to match the working tree
        // and exits 0 on `--check --3way` even when reporting `"with conflicts."` on stderr.
        // Stage touched paths into an isolated `GIT_INDEX_FILE` so unstaged local edits
        // participate cleanly as "ours" without mutating `.git/index` unless `--index` succeeds.
        const realIndexFile = Bun.file(path.join(targetRepoInfo.repo.gitDirectory, "index"))
        const tempEnv = { ...process.env, GIT_INDEX_FILE: tempIndex }
        if (await realIndexFile.exists()) {
          await Bun.write(tempIndex, realIndexFile)
        }
        if (!(await realIndexFile.exists())) {
          const readHead = Bun.spawnSync(["git", "read-tree", "HEAD"], {
            cwd: targetRepoInfo.canonicalWorktree,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            env: tempEnv,
          })
          if (readHead.exitCode !== 0) {
            return { clean: false, stderrText: new TextDecoder().decode(readHead.stderr).trim() }
          }
        }

        const partitionChangedPaths = async () => {
          const checks = await Promise.all(
            candidate.changedFiles.map(async (relPath) => ({
              relPath,
              exists: (await pathStatSafe(path.join(targetRepoInfo.canonicalWorktree, relPath))) !== undefined,
            })),
          )
          return {
            existing: checks.filter((item) => item.exists).map((item) => item.relPath),
            missing: checks.filter((item) => !item.exists).map((item) => item.relPath),
          }
        }

        const syncPathsToIndex = async (env: NodeJS.ProcessEnv) => {
          const partitioned = await partitionChangedPaths()
          if (partitioned.existing.length > 0) {
            const addProc = Bun.spawnSync(["git", "add", "-f", "--", ...partitioned.existing], {
              cwd: targetRepoInfo.canonicalWorktree,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              env,
            })
            if (addProc.exitCode !== 0) {
              return new TextDecoder().decode(addProc.stderr).trim() || "Failed to stage working tree paths for 3-way apply"
            }
          }
          if (partitioned.missing.length > 0) {
            const rmProc = Bun.spawnSync(["git", "update-index", "--remove", "--", ...partitioned.missing], {
              cwd: targetRepoInfo.canonicalWorktree,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              env,
            })
            if (rmProc.exitCode !== 0) {
              return new TextDecoder().decode(rmProc.stderr).trim() || "Failed to update removed paths for 3-way apply"
            }
          }
          return undefined
        }

        const prepErr = await syncPathsToIndex(tempEnv)
        if (prepErr) return { clean: false, stderrText: prepErr }

        const preflight = Bun.spawnSync(["git", "apply", "--check", "--3way", "--", tempPatch], {
          cwd: targetRepoInfo.canonicalWorktree,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: tempEnv,
        })
        const preflightStderr = new TextDecoder().decode(preflight.stderr).trim()
        const hasConflicts = /with conflicts\./i.test(preflightStderr)
        if (preflight.exitCode !== 0 || hasConflicts) {
          return { clean: false, stderrText: preflightStderr || "3-way merge reported conflicts" }
        }
        if (checkOnly) {
          return { clean: true, stderrText: preflightStderr }
        }

        const apply3Way = Bun.spawnSync(["git", "apply", "--3way", "--", tempPatch], {
          cwd: targetRepoInfo.canonicalWorktree,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: tempEnv,
        })
        const applyStderr = new TextDecoder().decode(apply3Way.stderr).trim()
        if (apply3Way.exitCode !== 0 || /with conflicts\./i.test(applyStderr)) {
          return { clean: false, stderrText: applyStderr || "3-way merge reported conflicts" }
        }
        if (stageIndex) {
          const stageErr = await syncPathsToIndex(process.env)
          if (stageErr) return { clean: false, stderrText: stageErr }
        }
        return { clean: true, stderrText: applyStderr }
      }

      const applyOutcome = await runGitApply()
      const stderrText = applyOutcome.stderrText
      const clean = applyOutcome.clean
      const applied = !checkOnly && clean

      const cleanedUp = await (async () => {
        if (!applied || !cleanup) return false
        if (candidate.manifest && candidate.batchDirectory) {
          await Effect.runPromise(
            Effect.gen(function* () {
              const git = yield* Git.Service
              for (const item of candidate.manifest!.attempts) {
                yield* git.worktree
                  .remove({
                    repository: targetRepoInfo.repo,
                    directory: AbsolutePath.make(item.worktreeRoot),
                    force: true,
                  })
                  .pipe(Effect.catch(() => Effect.void))
              }
            }).pipe(Effect.provide(gitRuntimeLayer)),
          ).catch(() => undefined)
          await rm(candidate.batchDirectory, { recursive: true, force: true }).catch(() => undefined)
          return true
        }
        if (candidate.standaloneWorktreeRoot) {
          await Effect.runPromise(
            Effect.gen(function* () {
              const git = yield* Git.Service
              yield* git.worktree
                .remove({
                  repository: targetRepoInfo.repo,
                  directory: AbsolutePath.make(candidate.standaloneWorktreeRoot!),
                  force: true,
                })
                .pipe(Effect.catch(() => Effect.void))
            }).pipe(Effect.provide(gitRuntimeLayer)),
          )
          return true
        }
        return false
      })()

      const report: ApplyReport = {
        type: "apply.result",
        targetDirectory: targetRepoInfo.canonicalWorktree,
        sourceKind: candidate.sourceKind,
        sourcePath: candidate.sourcePath,
        ...(candidate.batchDirectory ? { batchDirectory: candidate.batchDirectory } : {}),
        ...(candidate.attempt !== undefined ? { attempt: candidate.attempt } : {}),
        ...(candidate.sessionID ? { sessionID: candidate.sessionID } : {}),
        checkOnly,
        threeWay,
        index: stageIndex,
        clean,
        applied,
        cleanedUp,
        changedFiles: candidate.changedFiles,
        diffStat: candidate.diffStat,
        ...(clean ? {} : { error: stderrText || "git apply reported conflicts" }),
      }

      if (jsonOutput) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        if (!clean) process.exitCode = 1
        return
      }

      if (!clean) {
        const hint = !threeWay ? `${EOL}Tip: retry with "--3way" to attempt a 3-way merge.` : ""
        failApply(`Failed to apply candidate changes:${EOL}${stderrText || "git apply failed"}${hint}`)
      }

      process.stdout.write(formatApplyReport(report))
    } finally {
      await rm(tempPatch, { force: true }).catch(() => undefined)
      if (tempIndex) {
        await rm(tempIndex, { force: true }).catch(() => undefined)
      }
    }
  },
})
