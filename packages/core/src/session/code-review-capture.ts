export * as CodeReviewCapture from "./code-review-capture"

import path from "node:path"
import { randomUUID } from "node:crypto"
import { CodeReview } from "@apexo/schema/code-review"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "../process"
import { AbsolutePath } from "../schema"
import { Git } from "../git"
import { FSUtil } from "../fs-util"
import { makeGlobalNode } from "../effect/app-node"

export class Failure extends Schema.TaggedErrorClass<Failure>()("CodeReviewCaptureFailure", {
  message: Schema.String,
}) {}
const maximumFile = 2 * 1024 * 1024
export const maximumCapture = 5 * 1024 * 1024
export const reviewPath = (root: string, value: string) => {
  const relative = path.isAbsolute(value) ? path.relative(root, value) : value
  const normalized = path.posix.normalize(relative.split(path.sep).join("/"))
  return validPath(normalized) ? normalized : undefined
}
export const validPath = (value: string) =>
  !!value &&
  !value.includes("\0") &&
  !value.includes("\\") &&
  !path.posix.isAbsolute(value) &&
  !/^[A-Za-z]:/.test(value) &&
  value.split("/").every((part) => part !== ".." && part !== "." && !!part)

const make = Effect.gen(function* () {
  const gitService = yield* Git.Service
  const proc = yield* AppProcess.Service
  const fs = yield* FSUtil.Service
  const command = (cwd: string, args: string[], env?: Record<string, string>, limit = maximumCapture) =>
    proc
      .run(
        ChildProcess.make(
          "git",
          ["--literal-pathspecs", "--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
          {
            cwd,
            extendEnv: true,
            env,
            stdin: "ignore",
          },
        ),
        { maxOutputBytes: limit, maxErrorBytes: 4096, timeout: "60 seconds" },
      )
      .pipe(Effect.mapError(() => new Failure({ message: "Review Git command could not run" })))
  const git = (cwd: string, args: string[], env?: Record<string, string>, limit?: number) =>
    command(cwd, args, env, limit).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0 && !result.stdoutTruncated
          ? Effect.succeed(result.stdout.toString("utf8"))
          : Effect.fail(
              new Failure({
                message: result.stdoutTruncated
                  ? "Captured content exceeds the review limit"
                  : "Review Git target is unavailable",
              }),
            ),
      ),
    )
  const read = (captured: CodeReview.Captured, side: "old" | "new", file: string) =>
    Effect.gen(function* () {
      const normalized = reviewPath(captured.root, file)
      if (!normalized) return yield* new Failure({ message: "Invalid review path" })
      const tree = side === "old" ? captured.beforeTree : captured.afterTree
      const entry = yield* git(captured.root, ["--literal-pathspecs", "ls-tree", "-z", tree, "--", normalized])
      if (
        !entry &&
        captured.files.some((item) =>
          side === "old"
            ? item.path === normalized && item.status === "added"
            : item.path === normalized && item.status === "deleted",
        )
      )
        return ""
      if (!entry || entry.startsWith("160000")) return yield* new Failure({ message: "Captured file is unavailable" })
      const text = yield* git(captured.root, ["show", `${tree}:${normalized}`], undefined, maximumFile)
      if (text.includes("\0")) return yield* new Failure({ message: "Captured file is binary" })
      return text
    })
  const capture = (directory: string, target: CodeReview.Target) =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* fs.resolve((yield* git(directory, ["rev-parse", "--show-toplevel"])).trim())
        const exclusions: { path: string; reason: string }[] = []
        // Index isolation does not isolate Git filters, including deferred index refreshes.
        const configured = yield* command(root, [
          "config",
          "--null",
          "--name-only",
          "--get-regexp",
          "^filter[.].*[.](clean|process|required)$",
        ])
        if (![0, 1].includes(configured.exitCode) || configured.stdoutTruncated)
          return yield* new Failure({ message: "Review Git filter configuration is unavailable" })
        const filters = [
          ...new Set(
            configured.stdout
              .toString("utf8")
              .split("\0")
              .filter(Boolean)
              .map((key) => key.slice(0, key.lastIndexOf("."))),
          ),
        ].flatMap((driver) => ["-c", `${driver}.clean=`, "-c", `${driver}.process=`, "-c", `${driver}.required=false`])
        const safeGit = (args: string[], env?: Record<string, string>, limit?: number) =>
          git(root, [...filters, ...args], env, limit)
        const resolve = (ref: string) =>
          Effect.gen(function* () {
            if (!ref.trim() || ref.startsWith("-") || ref.includes("\0"))
              return yield* new Failure({ message: "Invalid review ref" })
            return (yield* safeGit(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).pipe(
              Effect.mapError(() => new Failure({ message: `Review ref does not exist or is not a commit: ${ref}` })),
            )).trim()
          })
        const head = yield* resolve("HEAD").pipe(Effect.catch(() => Effect.succeed("")))
        const empty = (yield* safeGit(["hash-object", "-w", "-t", "tree", "--stdin"], undefined)).trim()
        const refs = yield* Effect.gen(function* () {
          if (target.type === "uncommitted") {
            const repository = yield* gitService.repo.discover(AbsolutePath.make(root))
            if (!repository) return yield* new Failure({ message: "The review directory is not a Git repository" })
            const snapshot = yield* gitService.index.capture({ repository, maximumUntrackedFileBytes: maximumFile })
            snapshot.conflicts.forEach((file) => exclusions.push({ path: file, reason: "conflict" }))
            snapshot.skipped.forEach((file) => exclusions.push({ path: file, reason: "oversized" }))
            return {
              base: head || empty,
              head: head || empty,
              before: head ? (yield* safeGit(["rev-parse", `${head}^{tree}`])).trim() : empty,
              after: snapshot.tree,
            }
          }
          if (!head && target.type !== "pr") return yield* new Failure({ message: "The repository has no HEAD commit" })
          if (target.type === "base") {
            const base = yield* resolve(target.ref)
            const mergeBase = (yield* safeGit(["merge-base", base, head])).trim()
            return {
              base,
              head,
              mergeBase,
              before: (yield* safeGit(["rev-parse", `${mergeBase}^{tree}`])).trim(),
              after: (yield* safeGit(["rev-parse", `${head}^{tree}`])).trim(),
            }
          }
          if (target.type === "commit") {
            const commit = yield* resolve(target.ref)
            const parents = (yield* safeGit(["rev-list", "--parents", "-n", "1", commit])).trim().split(" ")
            return {
              base: parents[1] ?? empty,
              head: commit,
              before: parents[1] ? (yield* safeGit(["rev-parse", `${parents[1]}^{tree}`])).trim() : empty,
              after: (yield* safeGit(["rev-parse", `${commit}^{tree}`])).trim(),
            }
          }
          if (!target.ref.trim() || target.ref.startsWith("-"))
            return yield* new Failure({ message: "Invalid PR target" })
          const result = yield* proc
            .run(
              ChildProcess.make("gh", ["pr", "view", target.ref, "--json", "baseRefOid,headRefOid,url"], {
                cwd: root,
                stdin: "ignore",
              }),
              { maxOutputBytes: 16_384, timeout: "30 seconds" },
            )
            .pipe(
              Effect.mapError(
                () => new Failure({ message: "PR capture requires an authenticated gh CLI on the server" }),
              ),
            )
          if (result.exitCode !== 0 || result.stdoutTruncated)
            return yield* new Failure({
              message: "PR capture failed; check the server's gh authentication and repository",
            })
          const pr = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ baseRefOid: Schema.String, headRefOid: Schema.String, url: Schema.String }),
          )(yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(result.stdout.toString("utf8"))).pipe(
            Effect.mapError(() => new Failure({ message: "Invalid PR response" })),
          )
          if (![pr.baseRefOid, pr.headRefOid].every((sha) => /^[0-9a-f]{40,64}$/.test(sha)))
            return yield* new Failure({ message: "Invalid PR revisions" })
          const url = URL.canParse(pr.url) ? new URL(pr.url) : undefined
          if (!url || url.protocol !== "https:" || !/^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname))
            return yield* new Failure({ message: "Unsupported PR URL" })
          const namespace = `refs/apexo-review/${randomUUID()}`
          yield* Effect.addFinalizer(() =>
            Effect.forEach(["base", "head"], (side) => command(root, ["update-ref", "-d", `${namespace}/${side}`]), {
              discard: true,
            }).pipe(Effect.ignore),
          )
          yield* safeGit([
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            `${url.origin}/${url.pathname.split("/").slice(1, 3).join("/")}.git`,
            `${pr.baseRefOid}:${namespace}/base`,
            `${pr.headRefOid}:${namespace}/head`,
          ])
          const mergeBase = (yield* safeGit(["merge-base", pr.baseRefOid, pr.headRefOid])).trim()
          return {
            base: pr.baseRefOid,
            head: pr.headRefOid,
            mergeBase,
            before: (yield* safeGit(["rev-parse", `${mergeBase}^{tree}`])).trim(),
            after: (yield* safeGit(["rev-parse", `${pr.headRefOid}^{tree}`])).trim(),
          }
        })
        const entries = (yield* safeGit([
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--name-status",
          "--find-renames",
          "-z",
          refs.before,
          refs.after,
        ]))
          .split("\0")
          .filter(Boolean)
        const files: CodeReview.Captured["files"][number][] = []
        const size = { bytes: 0 }
        // Git's NUL-delimited rename records consume two paths; avoid parsing quoted display paths.
        for (let i = 0; i < entries.length; ) {
          const status = entries[i++]!
          const oldPath = entries[i++]!
          const file = status.startsWith("R") ? entries[i++]! : oldPath
          if (!validPath(file) || !validPath(oldPath)) return yield* new Failure({ message: "Invalid Git path" })
          if (files.length >= 500) {
            exclusions.push({ path: file, reason: "file_limit" })
            continue
          }
          const stats = yield* safeGit([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--numstat",
            refs.before,
            refs.after,
            "--",
            oldPath,
            file,
          ])
          const modes = yield* Effect.all([
            safeGit(["ls-tree", "-l", refs.before, "--", oldPath]),
            safeGit(["ls-tree", "-l", refs.after, "--", file]),
          ])
          if (stats.startsWith("-\t") || modes.some((mode) => mode.startsWith("160000"))) {
            exclusions.push({
              path: file,
              reason: modes.some((mode) => mode.startsWith("160000")) ? "submodule" : "binary",
            })
            continue
          }
          if (modes.some((mode) => Number(/^\d+\s+\w+\s+\w+\s+(\d+)/.exec(mode)?.[1] ?? 0) > maximumFile)) {
            exclusions.push({ path: file, reason: "oversized" })
            continue
          }
          const patch = yield* safeGit([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--find-renames",
            "--unified=3",
            refs.before,
            refs.after,
            "--",
            oldPath,
            file,
          ]).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (patch === undefined || size.bytes + Buffer.byteLength(patch) > maximumCapture) {
            exclusions.push({ path: file, reason: "capture_limit" })
            continue
          }
          size.bytes += Buffer.byteLength(patch)
          files.push({
            path: file,
            ...(file !== oldPath ? { oldPath } : {}),
            status: status.startsWith("R")
              ? "renamed"
              : status === "A"
                ? "added"
                : status === "D"
                  ? "deleted"
                  : "modified",
            patch,
          })
        }
        return CodeReview.Captured.make({
          root,
          baseSha: refs.base,
          headSha: refs.head,
          ...(refs.mergeBase ? { mergeBaseSha: refs.mergeBase } : {}),
          beforeTree: refs.before,
          afterTree: refs.after,
          files,
          exclusions,
        })
      }),
    )
  const workspaceStatus = (captured: CodeReview.Captured) =>
    Effect.scoped(
      Effect.gen(function* () {
        const head = (yield* git(captured.root, ["rev-parse", "HEAD"])).trim()
        if (head !== captured.headSha) return "stale" as const
        const temporary = yield* Effect.acquireRelease(fs.makeTempDirectory(), (dir) =>
          fs.remove(dir, { recursive: true }).pipe(Effect.ignore),
        )
        const env = { GIT_INDEX_FILE: path.join(temporary, "index") }
        yield* git(captured.root, ["read-tree", captured.afterTree], env)
        const configured = yield* command(captured.root, [
          "config",
          "--null",
          "--name-only",
          "--get-regexp",
          "^filter[.].*[.](clean|process|required)$",
        ])
        if (![0, 1].includes(configured.exitCode) || configured.stdoutTruncated) return "unavailable" as const
        const filters = [
          ...new Set(
            configured.stdout
              .toString("utf8")
              .split("\0")
              .filter(Boolean)
              .map((key) => key.slice(0, key.lastIndexOf("."))),
          ),
        ].flatMap((driver) => ["-c", `${driver}.clean=`, "-c", `${driver}.process=`, "-c", `${driver}.required=false`])
        const changed = yield* command(
          captured.root,
          [...filters, "diff", "--no-ext-diff", "--no-textconv", "--quiet", captured.afterTree, "--"],
          env,
        )
        if (![0, 1].includes(changed.exitCode)) return "unavailable" as const
        const untracked = yield* git(captured.root, ["ls-files", "--others", "--exclude-standard", "-z"], env)
        return changed.exitCode === 1 || !!untracked ? ("stale" as const) : ("current" as const)
      }),
    ).pipe(Effect.catch(() => Effect.succeed("unavailable" as const)))
  return { capture, read, workspaceStatus }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/CodeReviewCapture") {}
export type Interface = Effect.Success<typeof make>
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [AppProcess.node, FSUtil.node, Git.node],
})
