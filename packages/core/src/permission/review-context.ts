export * as PermissionReviewContext from "./review-context"

import path from "node:path"
import { createHash } from "node:crypto"
import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm"
import { Context, Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { AppProcess } from "../process"
import { SessionHistory } from "../session/history"
import { SessionSchema } from "../session/schema"
import { SessionInputTable } from "../session/sql"
import { BashApproval } from "../tool/bash-approval"
import { which } from "../util/which"

export const Interactive = Context.Reference<boolean>("@apexo/PermissionReview/Interactive", {
  defaultValue: () => false,
})
export interface Action {
  readonly sessionID: SessionSchema.ID
  readonly callID: string
  /** This closure captures actual execution values, never public permission metadata. */
  readonly capture: Effect.Effect<{ readonly facts: unknown; readonly fingerprint: string }, Error>
}
export const CurrentAction = Context.Reference<Action | undefined>("@apexo/PermissionReview/Action", {
  defaultValue: () => undefined,
})

export const admissionSequence = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  db
    .select({ seq: SessionInputTable.admitted_seq })
    .from(SessionInputTable)
    .where(eq(SessionInputTable.session_id, sessionID))
    .orderBy(desc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.seq ?? -1),
    )

/** Only admitted human text still present in the effective context is authorization. */
export const instructions = Effect.fn("PermissionReviewContext.instructions")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
) {
  const boundary = yield* EventV2.latestSequence(db, sessionID)
  const context = yield* SessionHistory.loadEntries(db, sessionID)
  const ids = new Set(
    context.filter((entry) => entry.seq <= boundary && entry.message.type === "user").map((entry) => entry.message.id),
  )
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        eq(SessionInputTable.origin, "user"),
        lte(SessionInputTable.admitted_seq, boundary),
        lte(SessionInputTable.promoted_seq, boundary),
        isNotNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.withdrawn_seq),
      ),
    )
    .orderBy(desc(SessionInputTable.promoted_seq))
    .all()
    .pipe(Effect.orDie)
  return rows
    .filter((row) => ids.has(row.id))
    .slice(0, 5)
    .reverse()
    .map((row) => ({ messageID: row.id, text: row.prompt.text }))
})

export const redactURL = (value: string) =>
  value
    .replace(/(\w+:\/\/)[^/\s?#]*@/g, "$1")
    .replace(/([?&](?:token|key|password|access_token|auth)=)[^&#\s]*/gi, "$1[redacted]")

/** Deliberately narrow: a single literal command; unsupported shell semantics require a click. */
export function bash(input: {
  readonly sessionID: SessionSchema.ID
  readonly callID: string
  readonly cwd: string
  readonly shell: string
  readonly command: string
  readonly env: Effect.Effect<Readonly<Record<string, string>>>
  readonly background: boolean
  readonly policy: Effect.Effect<unknown, Error>
  readonly proc: AppProcess.Interface
  readonly fs: FSUtil.Interface
}): Action {
  const capture = Effect.gen(function* () {
    const env = yield* input.env
    const run = (file: string, args: string[]) =>
      input.proc
        .run(
          ChildProcess.make(file, args, {
            cwd: input.cwd,
            env: { ...env },
            extendEnv: false,
            stdin: "ignore",
          }),
          { timeout: "2 seconds", maxOutputBytes: 8192, maxErrorBytes: 1024 },
        )
        .pipe(
          Effect.mapError(() => new Error("Execution scope is unavailable")),
          Effect.flatMap((result) =>
            result.stdoutTruncated || result.stderrTruncated
              ? Effect.fail(new Error("Execution scope exceeds the capture limit"))
              : Effect.succeed({ code: result.exitCode, text: result.stdout.toString("utf8").trim() }),
          ),
        )
    if (input.background || BashApproval.shellKind(input.shell) !== "posix")
      return yield* Effect.fail(new Error("This execution mode needs manual approval"))
    if (
      Object.keys(env).some(
        (key) => key !== "GIT_PAGER" && /^(GIT_|BASH_ENV$|ENV$|ZDOTDIR$|BASH_FUNC_|LD_PRELOAD$|DYLD_)/.test(key),
      )
    )
      return yield* Effect.fail(new Error("Custom shell or Git environment needs manual approval"))
    const parsed = yield* Effect.promise(() => BashApproval.analyze(input.command, "posix"))
    const words = parsed.segments?.[0]?.words
    if (parsed.opaque || parsed.segments?.length !== 1 || !words?.length || !/^[\w./-]+$/.test(words[0]!))
      return yield* Effect.fail(new Error("Dynamic or compound commands need manual approval"))
    if (["cd", "env", "timeout", "nice", "sudo", "command", "exec", "sh", "bash", "zsh", "fish"].includes(words[0]!))
      return yield* Effect.fail(new Error("Shell wrappers need manual approval"))
    const program = BashApproval.head(words)
    const localTests =
      program === "bun" && (words[1] === "test" || (words[1] === "run" && /^test(?::|$)/.test(words[2] ?? "")))
    const version = program === "bun" && words.length === 2 && ["--version", "--revision"].includes(words[1]!)
    if (BashApproval.isExecVehicle(words) && !localTests && !version)
      return yield* Effect.fail(new Error("Opaque scripts or execution wrappers need manual approval"))
    const resolution = yield* run(input.shell, ["-c", `command -V '${words[0]}'`])
    if (
      resolution.code !== 0 ||
      !new RegExp(`^(?:${words[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is )?/[\\w./+ -]+$`).test(resolution.text)
    )
      return yield* Effect.fail(new Error("Shell aliases, functions or unresolved executables need manual approval"))
    const executable = yield* input.fs.resolve(resolution.text.replace(/^.* is /, ""))
    const cwd = yield* input.fs.resolve(input.cwd)
    if (cwd !== input.cwd) return yield* Effect.fail(new Error("Working directory changed"))
    const repositories = yield* input.fs.up({ targets: [".git"], start: cwd })
    if ([cwd, ...repositories.map((entry) => path.dirname(entry))].some((root) => FSUtil.contains(root, executable)))
      return yield* Effect.fail(new Error("Workspace executable wrappers need manual approval"))
    // Scope queries must never launch a tool-supplied Git wrapper, even outside the worktree.
    if (program === "git") {
      const installed = which("git")
      if (!installed || executable !== (yield* input.fs.resolve(installed)))
        return yield* Effect.fail(new Error("Custom Git executables need manual approval"))
    }
    if (redactURL(input.command) !== input.command)
      return yield* Effect.fail(new Error("Commands containing URL credentials need manual approval"))
    const policy = yield* input.policy
    // Confined commands use a separate fixed environment; host Git queries cannot attest to it.
    if (!policy || typeof policy !== "object" || !("profile" in policy) || policy.profile !== "off")
      return yield* Effect.fail(new Error("Sandboxed execution scope needs manual approval"))
    const git = (args: string[]) =>
      run(executable, ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args]).pipe(
        Effect.flatMap((result) =>
          result.code === 0 ? Effect.succeed(result.text) : Effect.fail(new Error("Git scope could not be resolved")),
        ),
      )
    const config = (key: string) =>
      run(executable, ["config", "--get-all", key]).pipe(
        Effect.flatMap((result) =>
          result.code === 0 || result.code === 1
            ? Effect.succeed(result.text)
            : Effect.fail(new Error("Git configuration is unavailable")),
        ),
      )
    const push = path.basename(words[0]!) === "git" ? yield* gitScope(words, git, config, input.fs) : undefined
    const facts = {
      tool: "bash",
      cwd,
      shell: input.shell,
      executable,
      command: input.command,
      args: words.slice(1),
      policy,
      ...(push ? { git: push.public } : {}),
    }
    return {
      facts,
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ facts, privateGit: push?.private }))
        .digest("hex"),
    }
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.mapError((error) => (error instanceof Error ? error : new Error("Execution scope capture timed out"))),
  )
  return { sessionID: input.sessionID, callID: input.callID, capture }
}

function gitScope(
  words: readonly string[],
  git: (args: string[]) => Effect.Effect<string, Error>,
  config: (key: string) => Effect.Effect<string, Error>,
  fs: FSUtil.Interface,
) {
  return Effect.gen(function* () {
    if (words[1] !== "push") {
      if (words[1]?.startsWith("-")) return yield* Effect.fail(new Error("Git overrides need manual approval"))
      return undefined
    }
    const flags = words.slice(2).filter((word) => word.startsWith("-"))
    if (
      flags.some(
        (flag) =>
          ![
            "--force",
            "-f",
            "--delete",
            "-d",
            "--set-upstream",
            "-u",
            "--dry-run",
            "-n",
            "--no-verify",
            "--force-with-lease",
          ].includes(flag),
      )
    )
      return yield* Effect.fail(new Error("Unsupported Git push options need manual approval"))
    const operands = words.slice(2).filter((word) => !word.startsWith("-"))
    const repository = yield* fs.resolve(yield* git(["rev-parse", "--show-toplevel"]))
    const gitDirectory = yield* fs.resolve(yield* git(["rev-parse", "--absolute-git-dir"]))
    const branch = yield* git(["symbolic-ref", "--quiet", "--short", "HEAD"])
    const head = yield* git(["rev-parse", "--verify", "HEAD^{commit}"])
    const remotes = (yield* git(["remote"])).split("\n").filter(Boolean)
    const remote =
      operands[0] ||
      (yield* config(`branch.${branch}.pushRemote`)) ||
      (yield* config("remote.pushDefault")) ||
      (yield* config(`branch.${branch}.remote`)) ||
      (remotes.length === 1 ? remotes[0] : undefined)
    if (!remote || !remotes.includes(remote) || /\s/.test(remote))
      return yield* Effect.fail(new Error("Git push remote is ambiguous"))
    const urls = (yield* git(["remote", "get-url", "--push", "--all", remote])).split("\n").filter(Boolean)
    if (!urls.length || urls.length > 5) return yield* Effect.fail(new Error("Git push URLs are ambiguous"))
    const deletion = flags.some((flag) => flag === "--delete" || flag === "-d")
    const mirror = yield* config(`remote.${remote}.mirror`)
    const followTags = yield* config("push.followTags")
    const recurse = yield* config("push.recurseSubmodules")
    const receive = yield* config(`remote.${remote}.receivepack`)
    const ssh = yield* config("core.sshCommand")
    if (
      [mirror, followTags].some((value) => value && value !== "false" && value !== "no" && value !== "0") ||
      (recurse && recurse !== "no") ||
      receive ||
      ssh
    )
      return yield* Effect.fail(new Error("Custom Git push behavior needs manual approval"))
    const configured = yield* config(`remote.${remote}.push`)
    const defaults = yield* config("push.default")
    const merge = yield* config(`branch.${branch}.merge`)
    const upstreamRemote = yield* config(`branch.${branch}.remote`)
    const specs =
      operands.length > 1
        ? operands.slice(1)
        : configured
          ? configured.split("\n")
          : [
              defaults === "current"
                ? `${branch}:refs/heads/${branch}`
                : (!defaults || defaults === "simple" || defaults === "upstream") &&
                    upstreamRemote === remote &&
                    merge &&
                    (defaults === "upstream" || merge === `refs/heads/${branch}`)
                  ? `${branch}:${merge}`
                  : "",
            ]
    if (!specs.length || specs.length > 8 || specs.some((spec) => !spec || /[\s*?\[\]~^{}\\]/.test(spec)))
      return yield* Effect.fail(new Error("Git push destinations are ambiguous"))
    const refs = yield* Effect.forEach(specs, (spec) =>
      Effect.gen(function* () {
        const force =
          spec.startsWith("+") || flags.some((flag) => ["--force", "-f", "--force-with-lease"].includes(flag))
        const parts = spec.replace(/^\+/, "").split(":")
        if (parts.length > 2) return yield* Effect.fail(new Error("Git refspec is invalid"))
        const source = deletion ? "" : parts[0]!
        const sourceRef = source ? yield* git(["rev-parse", "--symbolic-full-name", source]) : ""
        const destination = parts[1] || (deletion ? parts[0] : sourceRef)
        if (destination?.startsWith("refs/") && !destination.startsWith("refs/heads/"))
          return yield* Effect.fail(new Error("Non-branch Git push destinations need manual approval"))
        if (destination && !destination.startsWith("refs/") && (!source || !sourceRef.startsWith("refs/heads/")))
          return yield* Effect.fail(new Error("Unqualified Git push destination is ambiguous"))
        const destinationRef = destination?.startsWith("refs/heads/")
          ? destination
          : destination
            ? `refs/heads/${destination}`
            : undefined
        if (
          !destinationRef ||
          (!source && !deletion && parts.length !== 2) ||
          (parts.length === 1 && source && !sourceRef.startsWith("refs/heads/"))
        )
          return yield* Effect.fail(new Error("Git push destination needs manual approval"))
        yield* git(["check-ref-format", destinationRef])
        const commit = source ? yield* git(["rev-parse", "--verify", `${source}^{commit}`]) : undefined
        return { source, sourceRef, commit, destination: destinationRef, force, delete: !source }
      }),
    )
    return {
      public: { repository, gitDirectory, branch, head, remote, urls: urls.map(redactURL), refs },
      private: urls,
    }
  })
}
