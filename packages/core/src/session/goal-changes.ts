import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { AppProcess } from "../process"

const patchLimit = 256 * 1024
const listLimit = 2 * 1024 * 1024
const hash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export type Capture = {
  baseline?: string
  source?: "baseline" | "git_history" | "mtime"
  derivedBaseline?: string
  head?: string
  status: "captured" | "unavailable"
  reason?: string
  files: string[]
  patches: { files: string[]; text: string }[]
  truncated: boolean
  omitted: number
}

/** Read-only Git evidence. Never stages files or changes the user's index. */
export function make(process: AppProcess.Interface) {
  const run = (directory: string, args: string[], limit: number, timeout = 10_000) =>
    process.run(
      ChildProcess.make("git", ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], {
        cwd: directory,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
      { maxOutputBytes: limit, maxErrorBytes: 4096, timeout },
    )

  const baseline = (directory: string) =>
    run(directory, ["rev-parse", "--verify", "HEAD^{commit}"], 256, 1000).pipe(
      Effect.map((result) => {
        const commit = result.stdout.toString("utf8").trim()
        return result.exitCode === 0 && !result.stdoutTruncated && hash.test(commit) ? commit : undefined
      }),
      Effect.catch(() => Effect.succeed(undefined)),
    )
  return {
    baseline,
    capture: (input: {
      directory: string
      baseline?: string
      createdAt?: number
      canRead: (absolute: string) => boolean
    }) =>
      Effect.gen(function* () {
        const unavailable = (reason: string): Capture => ({
          baseline: input.baseline,
          status: "unavailable",
          reason,
          files: [],
          patches: [],
          truncated: false,
          omitted: 0,
        })
        const diff = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--relative"]
        const capture = (base: string, head?: string) =>
          Effect.gen(function* () {
            const range = head ? [base, head] : [base]
            const lists = yield* Effect.all([
              run(input.directory, [...diff, "--name-only", "-z", ...range, "--", "."], listLimit),
              run(input.directory, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."], listLimit),
            ])
            if (lists.some((item) => item.exitCode !== 0 || item.stdoutTruncated))
              return unavailable("Git could not produce a complete changed-file list")
            const decode = (bytes: Buffer) =>
              new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0").filter(Boolean)
            const tracked = yield* Effect.try({ try: () => decode(lists[0].stdout), catch: (error) => error })
            const untracked = yield* Effect.try({ try: () => decode(lists[1].stdout), catch: (error) => error })
            const all = [...new Set([...tracked, ...untracked])].sort()
            const allowed = (file: string) => {
              const absolute = path.resolve(input.directory, file)
              const relative = path.relative(input.directory, absolute)
              return (
                relative !== ".." &&
                !relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relative) &&
                input.canRead(absolute)
              )
            }
            const files = all.filter(allowed)
            const state: Capture = {
              baseline: input.baseline,
              source: head ? "git_history" : "baseline",
              ...(head ? { derivedBaseline: base, head } : {}),
              status: "captured",
              files,
              patches: [],
              truncated: false,
              omitted: all.length - files.length,
            }
            // One file per patch keeps subsequent role-specific filtering safe; filenames need no diff parser.
            const budget = { remaining: patchLimit }
            for (const file of tracked.filter(allowed)) {
              if (!budget.remaining) {
                state.truncated = true
                break
              }
              const result = yield* run(
                input.directory,
                [...diff, "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--patch", ...range, "--", file],
                budget.remaining,
              )
              if (result.exitCode !== 0) return unavailable("Git failed while capturing a changed file")
              // Streaming decode drops an incomplete trailing UTF-8 code point at the byte cap.
              const text = new TextDecoder().decode(result.stdout, { stream: result.stdoutTruncated })
              state.patches.push({ files: [file], text })
              budget.remaining -= result.stdout.length
              state.truncated ||= result.stdoutTruncated
            }
            return state
          }).pipe(Effect.catch(() => Effect.succeed(unavailable("Git capture failed"))))
        return yield* Effect.gen(function* () {
          if (input.baseline && hash.test(input.baseline)) {
            const recorded = yield* capture(input.baseline)
            if (recorded.status === "captured") return recorded
          }
          if (input.createdAt === undefined || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0)
            return unavailable("No usable Git baseline or Goal creation time was recorded")
          const history = yield* Effect.gen(function* () {
            const head = yield* baseline(input.directory)
            if (!head) return
            const log = yield* run(
              input.directory,
              ["log", `--since=@${Math.floor(input.createdAt! / 1000)}`, "--reverse", "--format=%H"],
              listLimit,
            )
            if (log.exitCode !== 0 || log.stdoutTruncated) return
            const oldest = log.stdout.toString("utf8").trim().split("\n")[0]
            if (!oldest || !hash.test(oldest)) return
            const parent = yield* run(input.directory, ["rev-parse", "--verify", `${oldest}^`], 256)
            const base =
              parent.exitCode === 0
                ? parent
                : yield* run(input.directory, ["hash-object", "-t", "tree", "--stdin"], 256)
            const commit = base.stdout.toString("utf8").trim()
            if (base.exitCode !== 0 || base.stdoutTruncated || !hash.test(commit)) return
            return yield* capture(commit, head)
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (history?.status === "captured") return history
          const walked = yield* Effect.tryPromise(async (signal) => {
            const { SessionGoalWalk } = await import("./goal-changes-walk")
            return SessionGoalWalk.scan({ ...input, createdAt: input.createdAt! }, signal)
          })
          return { ...walked, ...(input.baseline ? { baseline: input.baseline } : {}) }
        }).pipe(
          Effect.timeout(30_000),
          Effect.catch(() =>
            Effect.succeed(unavailable("Goal change capture failed or exceeded its limits or deadline")),
          ),
        )
      }),
  }
}

/** All reviewers share one capture; a narrower role receives only its permitted paths. */
export function materialize(capture: Capture, canRead: (file: string) => boolean) {
  const files = capture.files.filter(canRead)
  return {
    patch:
      capture.patches
        .filter((patch) => patch.files.every(canRead))
        .map((patch) => patch.text)
        .join("") +
      (capture.truncated
        ? "\n# Patch truncated at the capture byte limit; inspect the complete permitted file list.\n"
        : "") +
      (capture.source === "mtime"
        ? "\n# Mtime fallback shows current content only; deleted files and prior contents cannot be recovered.\n"
        : "\n# Untracked files appear in the file list only. Read their current content with workspace tools.\n"),
    manifest: JSON.stringify({
      baseline: capture.baseline,
      source: capture.source,
      derivedBaseline: capture.derivedBaseline,
      head: capture.head,
      status: capture.status,
      reason: capture.reason,
      files,
      truncated: capture.truncated,
      omitted: capture.omitted + capture.files.length - files.length,
      note: "This is a scope pointer, not proof of completion. Inspect current files and run relevant checks. Git history fallback covers committed changes; mtime fallback cannot reconstruct prior contents or deletions. Omitted paths require permission; unavailable evidence is never evidence of no changes.",
    }),
  }
}

export * as SessionGoalChanges from "./goal-changes"
