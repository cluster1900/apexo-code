import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { EOL } from "node:os"
import path from "node:path"
import { Effect, Schema } from "effect"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { FSUtil } from "@apexo/core/fs-util"
import { Git } from "@apexo/core/git"
import { Global } from "@apexo/core/global"
import { AbsolutePath } from "@apexo/core/schema"
import { Slug } from "@apexo/core/util/slug"
import { SessionInput } from "@apexo/schema/session-input"
import { SessionMessage } from "@apexo/schema/session-message"
import { createApexoClient, type ApexoClient } from "@apexo/sdk/v2/client"
import { nativeSessionTransport } from "@apexo/tui/transport/native-session"
import { readPipedStdin } from "./cmd/run/runtime.stdin"
import type { RunInput } from "./cmd/run/types"
import { CliError } from "./effect-cmd"
import { nativeHeadlessOutput } from "./native-headless-output"
import { nativeLocalDirectory } from "./native-local"
import { createNativeLocalHost } from "./native-local-host"
import {
  appendOutputSchemaPrompt,
  loadOutputSchema,
  parseStructuredText,
  validateRunOutputOptions,
  writeLastMessage,
  type LoadedOutputSchema,
} from "./run-output-options"

export interface ParallelAttemptItem {
  readonly attempt: number
  readonly status: "completed" | "failed" | "interrupted"
  readonly sessionID?: string
  readonly directory: string
  readonly worktreeReplacedOnExit: boolean
  readonly changedFiles: ReadonlyArray<string>
  readonly diffStat: string
  readonly message: string
  readonly error?: string
}

export interface ParallelAttemptsReport {
  readonly type: "attempts.result"
  readonly total: number
  readonly succeeded: number
  readonly failed: number
  readonly sourceDirectory: string
  readonly attempts: ReadonlyArray<ParallelAttemptItem>
}

export interface ParallelAttemptsArgs {
  readonly attempts?: number
  readonly message?: ReadonlyArray<string>
  readonly "--"?: ReadonlyArray<string>
  readonly file?: ReadonlyArray<string>
  readonly dir?: string
  readonly model?: string
  readonly variant?: string
  readonly agent?: string
  readonly format?: string
  readonly "output-schema"?: string
  readonly "output-last-message"?: string
  readonly o?: string
  readonly ephemeral?: boolean
  readonly auto?: boolean
  readonly yolo?: boolean
  readonly "dangerously-skip-permissions"?: boolean
  readonly thinking?: boolean
  readonly profile?: string
  readonly mini?: boolean
  readonly interactive?: boolean
  readonly attach?: string
  readonly session?: string
  readonly continue?: boolean
  readonly fork?: boolean
  readonly "input-id"?: string
  readonly command?: string
  readonly demo?: boolean
}

const gitRuntimeLayer = AppNodeBuilder.build(LayerNode.group([Git.node, FSUtil.node, CrossSpawnSpawner.node]))

function failCli(message: string): never {
  throw new CliError({ message })
}

async function hashFileSafe(filepath: string): Promise<string | undefined> {
  const file = Bun.file(filepath)
  if (!(await file.exists())) return undefined
  const bytes = await file.bytes()
  return createHash("sha256").update(bytes).digest("hex")
}

function listDirtyPaths(worktree: string): string[] {
  const tracked = Bun.spawnSync(["git", "diff", "--name-only", "HEAD"], {
    cwd: worktree,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const untracked = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard"], {
    cwd: worktree,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const decoder = new TextDecoder()
  const names = [
    ...decoder.decode(tracked.stdout).split(/\r?\n/),
    ...decoder.decode(untracked.stdout).split(/\r?\n/),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
  return [...new Set(names)].toSorted()
}

async function snapshotDirtyHashes(worktree: string): Promise<Map<string, string | undefined>> {
  const dirty = listDirtyPaths(worktree)
  const entries = await Promise.all(
    dirty.map(async (rel) => [rel, await hashFileSafe(path.join(worktree, rel))] as const),
  )
  return new Map(entries)
}

async function inspectWorktreeChanges(
  worktree: string,
  baseline: ReadonlyMap<string, string | undefined>,
): Promise<{ changedFiles: string[]; diffStat: string }> {
  const currentDirty = listDirtyPaths(worktree)
  const changed: string[] = []
  for (const rel of currentDirty) {
    const nowHash = await hashFileSafe(path.join(worktree, rel))
    if (!baseline.has(rel) || baseline.get(rel) !== nowHash) {
      changed.push(rel)
    }
  }
  for (const [rel, baseHash] of baseline) {
    if (baseHash !== undefined && !currentDirty.includes(rel)) {
      const nowHash = await hashFileSafe(path.join(worktree, rel))
      if (nowHash !== baseHash && !changed.includes(rel)) changed.push(rel)
    }
  }
  const sorted = changed.toSorted()
  if (sorted.length === 0) return { changedFiles: [], diffStat: "" }

  const untrackedProc = Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard", "--", ...sorted], {
    cwd: worktree,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const untrackedSet = new Set(
    new TextDecoder()
      .decode(untrackedProc.stdout)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const trackedChanged = sorted.filter((rel) => !untrackedSet.has(rel))
  const statLines: string[] = []
  if (trackedChanged.length > 0) {
    const statProc = Bun.spawnSync(["git", "diff", "--stat", "HEAD", "--", ...trackedChanged], {
      cwd: worktree,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = new TextDecoder().decode(statProc.stdout).trimEnd()
    if (text) statLines.push(text)
  }
  for (const rel of sorted) {
    if (untrackedSet.has(rel)) statLines.push(` ${rel} (new untracked file)`)
  }
  return { changedFiles: sorted, diffStat: statLines.join("\n") }
}

async function runSingleWorktreeAttempt(options: {
  readonly attempt: number
  readonly sdk: ApexoClient
  readonly directory: string
  readonly worktreeRoot: string
  readonly baselineHashes: ReadonlyMap<string, string | undefined>
  readonly text: string
  readonly files: RunInput["files"]
  readonly agent?: string
  readonly model?: RunInput["model"]
  readonly variant?: string
  readonly auto: boolean
  readonly thinking: boolean
  readonly outputSchema?: LoadedOutputSchema
  readonly ephemeral: boolean
  readonly signal: AbortSignal
}): Promise<ParallelAttemptItem> {
  const decode = Schema.decodeUnknownSync(SessionInput.Execution)
  const transport = nativeSessionTransport(options.sdk, options.directory, options.signal)
  let sessionID: string | undefined
  let inputID: string | undefined
  try {
    const catalog = await transport.catalog(AbortSignal.timeout(10000))
    const agent =
      options.agent ?? catalog.agents.find((item) => item.mode !== "subagent" && !item.hidden)?.id
    const configured = catalog.agents.find((item) => item.id === agent)?.model
    const fallback = catalog.models.find(
      (item) =>
        item.enabled && catalog.providers.some((provider) => provider.id === item.providerID && !provider.disabled),
    )
    const stored = configured ?? fallback
    const selected = options.model
      ? { providerID: options.model.providerID, id: options.model.modelID, variant: options.variant }
      : stored
        ? {
            providerID: stored.providerID,
            id: stored.id,
            variant: options.variant ?? ("variant" in stored ? stored.variant : undefined),
          }
        : undefined

    const session = await transport.create({ agent, model: selected }, AbortSignal.timeout(10000))
    sessionID = session.id
    inputID = SessionMessage.ID.create()
    const output = nativeHeadlessOutput({
      sessionID: session.id,
      inputID,
      directory: session.location.directory,
      format: "default",
      thinking: options.thinking,
      write: () => {},
      error: () => {},
    })

    const playback = { sequence: 0, prompted: false, closed: false }
    const replay = async (boundary?: number) => {
      while (!playback.closed) {
        const before = playback.sequence
        const page = (
          await options.sdk.v2.session.history(
            { sessionID: session.id, after: before, limit: 100 },
            { throwOnError: true, signal: AbortSignal.timeout(10000) },
          )
        ).data
        for (const event of page.data) {
          const durable = event.durable
          if (!durable) break
          if (boundary !== undefined && durable.seq > boundary) {
            playback.closed = true
            break
          }
          if (event.type === "session.next.prompted") {
            if (event.data.messageID === inputID) playback.prompted = true
            else if (playback.prompted) {
              playback.closed = true
              break
            }
          }
          output.apply(event)
          playback.sequence = durable.seq
          if (boundary !== undefined && durable.seq >= boundary) {
            playback.closed = true
            break
          }
        }
        if (!page.hasMore || playback.closed || playback.sequence <= before) break
      }
    }

    const promptText = options.outputSchema
      ? appendOutputSchemaPrompt(options.text, options.outputSchema.rawText)
      : options.text
    const request = {
      sessionID: session.id,
      id: inputID,
      prompt: {
        text: promptText,
        ...(options.files.length
          ? { files: options.files.map((file) => ({ uri: file.url, mime: file.mime, name: file.filename })) }
          : {}),
      },
      executionPolicy: {
        mode: "headless" as const,
        permissions: options.auto ? ("approve_once" as const) : ("reject" as const),
      },
    }

    const admitted = await transport.admit({ ...request, resume: false }, AbortSignal.timeout(10000))
    playback.sequence = admitted.admittedSeq - 1
    await transport.admit(request, AbortSignal.timeout(10000))

    while (true) {
      if (options.signal.aborted) {
        await options.sdk.v2.session.input
          .interrupt({ sessionID: session.id, inputID }, { signal: AbortSignal.timeout(5000) })
          .catch(() => undefined)
        const changes = await inspectWorktreeChanges(options.worktreeRoot, options.baselineHashes)
        return {
          attempt: options.attempt,
          status: "interrupted",
          sessionID: session.id,
          directory: options.directory,
          worktreeReplacedOnExit: options.ephemeral,
          changedFiles: changes.changedFiles,
          diffStat: changes.diffStat,
          message: output.lastMessage() ?? "",
          error: "Attempt interrupted",
        }
      }
      const waited = (
        await options.sdk.v2.session.input.wait(
          { sessionID: session.id, inputID, timeoutMs: 150 },
          { throwOnError: true, signal: AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) },
        )
      ).data.data
      const execution = decode(waited.execution)
      await replay(execution.endedSeq)
      if (waited.timedOut) continue
      output.finish(execution)

      const lastText = output.lastMessage() ?? ""
      const changes = await inspectWorktreeChanges(options.worktreeRoot, options.baselineHashes)
      if (execution.status !== "completed") {
        return {
          attempt: options.attempt,
          status: execution.status === "interrupted" ? "interrupted" : "failed",
          sessionID: session.id,
          directory: options.directory,
          worktreeReplacedOnExit: options.ephemeral,
          changedFiles: changes.changedFiles,
          diffStat: changes.diffStat,
          message: lastText,
          error: `Attempt ended with status ${execution.status} (${execution.reason})`,
        }
      }
      if (options.outputSchema) {
        const checked = parseStructuredText(lastText, options.outputSchema)
        if (!checked.ok) {
          return {
            attempt: options.attempt,
            status: "failed",
            sessionID: session.id,
            directory: options.directory,
            worktreeReplacedOnExit: options.ephemeral,
            changedFiles: changes.changedFiles,
            diffStat: changes.diffStat,
            message: lastText,
            error: checked.message,
          }
        }
        return {
          attempt: options.attempt,
          status: "completed",
          sessionID: session.id,
          directory: options.directory,
          worktreeReplacedOnExit: options.ephemeral,
          changedFiles: changes.changedFiles,
          diffStat: changes.diffStat,
          message: JSON.stringify(checked.value, null, 2),
        }
      }
      return {
        attempt: options.attempt,
        status: "completed",
        sessionID: session.id,
        directory: options.directory,
        worktreeReplacedOnExit: options.ephemeral,
        changedFiles: changes.changedFiles,
        diffStat: changes.diffStat,
        message: lastText,
      }
    }
  } catch (error) {
    if (options.signal.aborted && sessionID && inputID) {
      await options.sdk.v2.session.input
        .interrupt({ sessionID, inputID }, { signal: AbortSignal.timeout(5000) })
        .catch(() => undefined)
    }
    const changes = await inspectWorktreeChanges(options.worktreeRoot, options.baselineHashes).catch(() => ({
      changedFiles: [],
      diffStat: "",
    }))
    return {
      attempt: options.attempt,
      status: options.signal.aborted ? "interrupted" : "failed",
      ...(sessionID ? { sessionID } : {}),
      directory: options.directory,
      worktreeReplacedOnExit: options.ephemeral,
      changedFiles: changes.changedFiles,
      diffStat: changes.diffStat,
      message: "",
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (options.ephemeral && sessionID) {
      await options.sdk.v2.session
        .remove({ sessionID }, { signal: AbortSignal.timeout(5000) })
        .catch(() => undefined)
    }
  }
}

function formatAttemptsReport(report: ParallelAttemptsReport): string {
  const lines: string[] = [
    `Parallel Worktree Attempts: ${report.succeeded}/${report.total} completed (source: ${report.sourceDirectory})`,
  ]
  for (const item of report.attempts) {
    lines.push("")
    lines.push(`=== Attempt ${item.attempt}/${report.total} [${item.status.toUpperCase()}] ===`)
    lines.push(`Directory: ${item.directory}${item.worktreeReplacedOnExit ? " (ephemeral, cleaned up)" : ""}`)
    if (item.sessionID && !item.worktreeReplacedOnExit) lines.push(`Session:   ${item.sessionID}`)
    if (item.changedFiles.length > 0) {
      lines.push(`Changed:   ${item.changedFiles.join(", ")}`)
      if (item.diffStat) lines.push(item.diffStat)
    }
    if (item.changedFiles.length === 0) lines.push("Changed:   (no file modifications)")
    if (item.error) lines.push(`Error:     ${item.error}`)
    if (item.message.trim()) {
      lines.push("Message:")
      lines.push(item.message.trimEnd())
    }
  }
  return lines.join(EOL) + EOL
}

export async function runParallelAttempts(args: ParallelAttemptsArgs) {
  const attempts = args.attempts ?? 1
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 16) {
    failCli("--attempts must be an integer between 1 and 16")
  }
  const incompatible = [
    ["--mini / --interactive", Boolean(args.mini || args.interactive)],
    ["--attach", args.attach !== undefined],
    ["--session", args.session !== undefined],
    ["--continue", Boolean(args.continue)],
    ["--fork", Boolean(args.fork)],
    ["--input-id", args["input-id"] !== undefined],
    ["--command", args.command !== undefined],
    ["--demo", Boolean(args.demo)],
  ].find((entry) => entry[1])?.[0]
  if (incompatible) {
    failCli(`--attempts cannot be combined with ${incompatible}`)
  }
  const format = args.format ?? "default"
  if (format !== "default" && format !== "json") {
    failCli("--attempts supports --format default or --format json")
  }
  const rawLastMessage = args["output-last-message"] ?? args.o
  try {
    validateRunOutputOptions({
      interactive: false,
      ephemeral: args.ephemeral,
      outputSchema: args["output-schema"],
      outputLastMessage: rawLastMessage,
    })
  } catch (error) {
    failCli(error instanceof Error ? error.message : String(error))
  }

  const modelParts = args.model?.split("/")
  if (modelParts && (!modelParts[0] || !modelParts.slice(1).join("/"))) {
    failCli("Model must use provider/model syntax")
  }
  const model = modelParts ? { providerID: modelParts[0]!, modelID: modelParts.slice(1).join("/") } : undefined

  const callerRoot = path.resolve(process.env.PWD ?? process.cwd())
  const outputSchema = args["output-schema"]
    ? await loadOutputSchema(args["output-schema"], callerRoot).catch((error) =>
        failCli(error instanceof Error ? error.message : String(error)),
      )
    : undefined
  const outputLastMessage = rawLastMessage ? path.resolve(callerRoot, rawLastMessage) : undefined
  const startDirectory = await nativeLocalDirectory(args.dir).catch((error) =>
    failCli(error instanceof Error ? error.message : String(error)),
  )

  const positional = [...(args.message ?? []), ...(args["--"] ?? [])].join(" ")
  const piped = await readPipedStdin(positional.trim().length > 0 || Boolean(args.file?.length))
  const text = [positional, piped].filter(Boolean).join("\n")
  const filenames = args.file ?? []
  const files: RunInput["files"] = filenames.length
    ? await (async () => {
        const { readRunAttachment } = await import("./file-attachment")
        return Promise.all(filenames.map((filename) => readRunAttachment(path.resolve(startDirectory, filename))))
      })()
    : []
  if (!text.trim() && files.length === 0) {
    failCli("A prompt message or file attachment is required for --attempts")
  }

  if (args.profile) process.env.APEXO_RUNTIME_PROFILE = args.profile
  if (args.ephemeral && process.env.GROK_MEMORY === undefined) process.env.GROK_MEMORY = "0"

  const batchRoot = path.join(Global.make().data, "worktree", "attempts", `${Date.now()}-${Slug.create()}`)
  const worktrees = await Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git.Service
      const fs = yield* FSUtil.Service
      const repo = yield* git.repo.discover(AbsolutePath.make(startDirectory))
      if (!repo) {
        return yield* Effect.fail(new CliError({ message: `--attempts requires a Git repository (none found at ${startDirectory})` }))
      }
      const head = yield* git.history.head(repo)
      if (!head) {
        return yield* Effect.fail(
          new CliError({ message: "--attempts requires a Git repository with at least one commit (HEAD)" }),
        )
      }
      const baselineChanges = yield* git.change
        .capture({ repository: repo, path: repo.worktree })
        .pipe(Effect.mapError((err) => new CliError({ message: err.message })))
      const relativeSubdir = path.relative(repo.worktree, startDirectory)
      yield* Effect.promise(() => mkdir(batchRoot, { recursive: true }))

      const created: Array<{ attempt: number; worktreeRoot: AbsolutePath; directory: string }> = []
      return yield* Effect.gen(function* () {
        for (let idx = 1; idx <= attempts; idx += 1) {
          const targetRoot = AbsolutePath.make(path.join(batchRoot, `attempt-${idx}`))
          const wtRepo = yield* git.worktree
            .create({ repository: repo, directory: targetRoot, revision: head })
            .pipe(Effect.mapError((err) => new CliError({ message: err.message })))
          created.push({ attempt: idx, worktreeRoot: targetRoot, directory: targetRoot })
          if (baselineChanges) {
            yield* git.change
              .apply({ repository: wtRepo, path: targetRoot, changes: baselineChanges })
              .pipe(Effect.mapError((err) => new CliError({ message: err.message })))
          }
          const canonicalRoot = AbsolutePath.make(yield* fs.resolve(targetRoot))
          const targetDir = relativeSubdir ? path.join(canonicalRoot, relativeSubdir) : canonicalRoot
          created[created.length - 1] = { attempt: idx, worktreeRoot: canonicalRoot, directory: targetDir }
        }
        return { repo, created }
      }).pipe(
        Effect.onError(() =>
          Effect.gen(function* () {
            for (const wt of created) {
              yield* git.worktree
                .remove({ repository: repo, directory: wt.worktreeRoot, force: true })
                .pipe(Effect.catch(() => Effect.void))
            }
            yield* Effect.promise(() => rm(batchRoot, { recursive: true, force: true }).catch(() => undefined))
          }),
        ),
      )
    }).pipe(Effect.provide(gitRuntimeLayer)),
  )

  const baselinePerAttempt = await Promise.all(
    worktrees.created.map(async (item) => [item.attempt, await snapshotDirtyHashes(item.worktreeRoot)] as const),
  )
  const baselineMap = new Map(baselinePerAttempt)

  const controller = new AbortController()
  let interruptedSignal: "SIGINT" | "SIGTERM" | undefined
  const onSigint = () => {
    interruptedSignal ??= "SIGINT"
    controller.abort()
  }
  const onSigterm = () => {
    interruptedSignal ??= "SIGTERM"
    controller.abort()
  }
  process.on("SIGINT", onSigint)
  process.on("SIGTERM", onSigterm)

  const host = createNativeLocalHost(undefined, true)
  try {
    const auto = Boolean(args.auto || args.yolo || args["dangerously-skip-permissions"])
    const ephemeral = Boolean(args.ephemeral)
    const thinking = Boolean(args.thinking)
    const items = await Promise.all(
      worktrees.created.map((wt) =>
        runSingleWorktreeAttempt({
          attempt: wt.attempt,
          sdk: createApexoClient({ baseUrl: "http://apexo.local", fetch: host.fetch, directory: wt.directory }),
          directory: wt.directory,
          worktreeRoot: wt.worktreeRoot,
          baselineHashes: baselineMap.get(wt.attempt) ?? new Map(),
          text,
          files,
          agent: args.agent,
          model,
          variant: args.variant,
          auto,
          thinking,
          outputSchema,
          ephemeral,
          signal: controller.signal,
        }),
      ),
    )

    const ordered = items.toSorted((a, b) => a.attempt - b.attempt)
    const succeeded = ordered.filter((item) => item.status === "completed").length
    const report: ParallelAttemptsReport = {
      type: "attempts.result",
      total: attempts,
      succeeded,
      failed: attempts - succeeded,
      sourceDirectory: startDirectory,
      attempts: ordered,
    }

    const firstWinner = ordered.find((item) => item.status === "completed")
    if (outputLastMessage && firstWinner) {
      await writeLastMessage(
        outputLastMessage,
        outputSchema ? `${firstWinner.message}\n` : firstWinner.message,
      )
    }

    process.stdout.write(format === "json" ? JSON.stringify(report, null, 2) + EOL : formatAttemptsReport(report))
    if (interruptedSignal) {
      process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143
      return
    }
    process.exitCode = succeeded > 0 ? 0 : 1
  } finally {
    process.off("SIGINT", onSigint)
    process.off("SIGTERM", onSigterm)
    await host.close()
    if (args.ephemeral) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const git = yield* Git.Service
          for (const wt of worktrees.created) {
            yield* git.worktree
              .remove({ repository: worktrees.repo, directory: wt.worktreeRoot, force: true })
              .pipe(Effect.catch(() => Effect.void))
          }
        }).pipe(Effect.provide(gitRuntimeLayer)),
      ).catch(() => undefined)
      await rm(batchRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
