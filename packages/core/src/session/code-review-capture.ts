export * as CodeReviewCapture from "./code-review-capture"

import path from "node:path"
import { randomUUID } from "node:crypto"
import { CodeReview } from "@apexo/schema/code-review"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "../process"
import { FSUtil } from "../fs-util"
import { makeGlobalNode } from "../effect/app-node"

export class Failure extends Schema.TaggedErrorClass<Failure>()("CodeReviewCaptureFailure", {
  message: Schema.String,
}) {}
const maximumFile = 2 * 1024 * 1024
export const maximumCapture = 5 * 1024 * 1024
export const validPath = (value: string) =>
  !!value &&
  !value.includes("\0") &&
  !value.includes("\\") &&
  !path.posix.isAbsolute(value) &&
  !/^[A-Za-z]:/.test(value) &&
  value.split("/").every((part) => part !== ".." && part !== "." && !!part)

const make = Effect.gen(function* () {
  const proc = yield* AppProcess.Service
  const fs = yield* FSUtil.Service
  const command = (cwd: string, args: string[], env?: Record<string, string>, limit = maximumCapture) =>
    proc
      .run(
        ChildProcess.make("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
          cwd,
          extendEnv: true,
          env,
          stdin: "ignore",
        }),
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
      if (!validPath(file)) return yield* new Failure({ message: "Invalid review path" })
      const tree = side === "old" ? captured.beforeTree : captured.afterTree
      const entry = yield* git(captured.root, ["ls-tree", "-z", tree, "--", file])
      if (!entry || entry.startsWith("160000")) return yield* new Failure({ message: "Captured file is unavailable" })
      const text = yield* git(captured.root, ["show", `${tree}:${file}`], undefined, maximumFile)
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
            return (yield* safeGit(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim()
          })
        const head = yield* resolve("HEAD").pipe(Effect.catch(() => Effect.succeed("")))
        const empty = (yield* safeGit(["hash-object", "-w", "-t", "tree", "--stdin"], undefined)).trim()
        const refs = yield* Effect.gen(function* () {
          if (target.type === "uncommitted") {
            const temporary = yield* Effect.acquireRelease(fs.makeTempDirectory(), (dir) =>
              fs.remove(dir, { recursive: true }).pipe(Effect.ignore),
            )
            const env = { GIT_INDEX_FILE: path.join(temporary, "index") }
            yield* safeGit(head ? ["read-tree", head] : ["read-tree", "--empty"], env)
            const conflicts = (yield* safeGit([
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--name-only",
              "--diff-filter=U",
              "-z",
            ]))
              .split("\0")
              .filter(Boolean)
            const untracked = (yield* safeGit(["ls-files", "--others", "--exclude-standard", "-z"]))
              .split("\0")
              .filter(Boolean)
            const oversized = yield* Effect.filter(untracked, (file) =>
              Effect.gen(function* () {
                const link = yield* fs
                  .readLink(path.join(root, file))
                  .pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (link !== undefined) return false
                return yield* fs.stat(path.join(root, file)).pipe(
                  Effect.map((info) => Number(info.size) > maximumFile),
                  Effect.catch(() => Effect.succeed(true)),
                )
              }),
            )
            const omitted = new Set([...conflicts, ...oversized])
            conflicts.forEach((file) => exclusions.push({ path: file, reason: "conflict" }))
            oversized.forEach((file) => exclusions.push({ path: file, reason: "oversized" }))
            // Pathspecs are literal: filenames containing glob characters cannot widen capture.
            const files = (yield* safeGit(["ls-files", "--cached", "-z"])).split("\0").filter(Boolean)
            const paths = [...new Set([...files, ...untracked])].filter((file) => !omitted.has(file))
            yield* Effect.forEach(
              Array.from({ length: Math.ceil(paths.length / 100) }, (_, i) => paths.slice(i * 100, i * 100 + 100)),
              (batch) => safeGit(["--literal-pathspecs", "add", "-A", "--", ...batch], env),
              { discard: true },
            )
            return {
              base: head || empty,
              head: head || empty,
              before: head ? (yield* safeGit(["rev-parse", `${head}^{tree}`])).trim() : empty,
              after: (yield* safeGit(["write-tree"], env)).trim(),
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
  deps: [AppProcess.node, FSUtil.node],
})
