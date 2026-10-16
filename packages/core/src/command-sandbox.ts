export * as CommandSandbox from "./command-sandbox"
export { Failure } from "./command-sandbox/policy"

import { randomUUID } from "node:crypto"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { Context, DateTime, Duration, Effect, Layer } from "effect"
import { Sandbox } from "@apexo/schema/sandbox"
import { Bwrap } from "./command-sandbox/linux"
import { CommandSandboxPaths } from "./command-sandbox/paths"
import { CommandSandboxPolicy } from "./command-sandbox/policy"
import { Seatbelt } from "./command-sandbox/seatbelt"
import { makeLocationNode } from "./effect/app-node"
import { Global } from "./global"
import { Location } from "./location"
import { AppProcess } from "./process"
import { SessionCommandSandbox } from "./session/command-sandbox"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionSchema } from "./session/schema"

const PROJECT_PROTECTED_NAMES = [
  ".apexo",
  ".opencode",
  ".grok",
  ".git",
  ".claude",
  ".cursor",
  ".vscode",
  ".idea",
  "apexo.json",
  "apexo.jsonc",
  "opencode.json",
  "opencode.jsonc",
  ".mcp.json",
  ".lsp.json",
  "AGENTS.md",
  "CLAUDE.md",
]

export const make = Effect.gen(function* () {
  const global = yield* Global.Service
  const location = yield* Location.Service
  const appProcess = yield* AppProcess.Service
  const sessions = yield* SessionCommandSandbox.Service
  const backendKind: Sandbox.Status["backend"]["kind"] =
    process.platform === "darwin" ? "seatbelt" : process.platform === "linux" ? "bwrap" : "none"
  const backend: { availability: Sandbox.Status["backend"]["availability"] } = {
    availability: backendKind === "none" ? "unsupported" : "unchecked",
  }
  const receipts = new WeakMap<SessionLifecycle.Claim, { created: string; receipt: Sandbox.Receipt }>()
  const failures = new WeakMap<
    SessionLifecycle.Claim,
    { created: string; failure: NonNullable<Sandbox.Status["failure"]> }
  >()
  const temporary = Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => realpath(await mkdtemp(path.join(global.tmp, "command-sandbox-"))),
      catch: () =>
        new CommandSandboxPolicy.Failure({
          code: "unavailable",
          message: "The command sandbox temporary directory is unavailable.",
        }),
    }),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(Effect.orDie),
  )
  const prepare = (policy: CommandSandboxPolicy.Confined, input: { shell: string; command: string; cwd: string }) =>
    Effect.gen(function* () {
      if (backendKind === "none")
        return yield* new CommandSandboxPolicy.Failure({
          code: "unsupported_platform",
          message: "Native command sandboxing currently supports macOS and Linux only.",
        })
      yield* CommandSandboxPaths.verify(policy)
      const directory = yield* temporary
      const launchInput: Seatbelt.Input = {
        ...input,
        workspace: policy.workspace,
        profile: policy.profile,
        base: policy.base,
        network: policy.network,
        protected: policy.protected,
        ancestors: policy.ancestors,
        readOnly: policy.readOnly,
        readWrite: policy.readWrite,
        denyLiterals: policy.denyLiterals,
        denyGlobs: policy.denyGlobs,
        temporary: directory,
        home: directory,
      }
      return yield* Effect.try({
        try: () => (backendKind === "bwrap" ? Bwrap.prepare(launchInput) : Seatbelt.prepare(launchInput)),
        catch: () =>
          new CommandSandboxPolicy.Failure({
            code: "invalid_policy",
            message: "The command sandbox launch request is invalid.",
          }),
      })
    })
  return {
    /** Explicit selection only; configuration documents are not security defaults. */
    preflight: (profile: Sandbox.Profile) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (profile === "off") return CommandSandboxPolicy.off
          const policy = yield* CommandSandboxPaths.resolve({
            workspace: location.directory,
            profile,
            home: global.home,
            protected: [
              global.config,
              global.data,
              global.state,
              global.cache,
              ...PROJECT_PROTECTED_NAMES.map((name) => path.join(location.directory, name)),
            ],
          })
          if (CommandSandboxPolicy.isOff(policy)) return policy
          if (backendKind === "none")
            return yield* new CommandSandboxPolicy.Failure({
              code: "unsupported_platform",
              message: "Native command sandboxing currently supports macOS and Linux only.",
            })
          const probe = yield* prepare(policy, { shell: "/bin/sh", command: "exit 0", cwd: policy.workspace })
          const result = yield* appProcess
            .run(probe.command, { timeout: Duration.seconds(3), maxOutputBytes: 512, maxErrorBytes: 1024 })
            .pipe(
              Effect.mapError(
                () =>
                  new CommandSandboxPolicy.Failure({
                    code: "unavailable",
                    message: "The command sandbox backend could not start.",
                  }),
              ),
            )
          if (!probe.confirm(result) || result.exitCode !== 0)
            return yield* new CommandSandboxPolicy.Failure({
              code: "unavailable",
              message: "The command sandbox backend did not confirm policy application.",
            })
          backend.availability = "available"
          return policy
        }),
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (error.code === "unavailable") backend.availability = "unavailable"
          }),
        ),
      ),
    status: (sessionID: SessionSchema.ID): Effect.Effect<Sandbox.Status, SessionLifecycle.Closed> =>
      Effect.gen(function* () {
        const current = yield* sessions.inspect(sessionID)
        const receipt = receipts.get(current.claim)
        const failure = failures.get(current.claim)
        return {
          scope: "native_commands" as const,
          stored: true,
          profile: current.policy.profile,
          revision: current.policy.revision,
          network: current.policy.network,
          backend: {
            kind: backendKind,
            availability: backend.availability,
          },
          ...(receipt?.created === current.created ? { latestExecution: receipt.receipt } : {}),
          ...(failure?.created === current.created ? { failure: failure.failure } : {}),
        } satisfies Sandbox.Status
      }).pipe(
        Effect.catchTag("CommandSandbox.Failure", (failure) =>
          Effect.succeed({
            scope: "native_commands" as const,
            stored: false,
            backend: {
              kind: backendKind,
              availability: backend.availability,
            },
            failure: { code: failure.code, message: failure.message },
          } satisfies Sandbox.Status),
        ),
      ),
    assertRead: (sessionID: SessionSchema.ID, targetPath: string, rawPath?: string) =>
      Effect.gen(function* () {
        const current = yield* sessions.inspect(sessionID)
        if (CommandSandboxPolicy.isOff(current.policy)) return
        const policy = current.policy
        yield* CommandSandboxPaths.verify(policy)
        const resolved = yield* Effect.tryPromise({
          try: () => CommandSandboxPaths.resolveTarget(rawPath ?? targetPath, policy.workspace),
          catch: (error) =>
            error instanceof CommandSandboxPolicy.Failure
              ? error
              : new CommandSandboxPolicy.Failure({
                  code: "unsafe_path",
                  message: `Sandbox blocked read access to ${rawPath ?? targetPath}`,
                }),
        })
        if (
          !CommandSandboxPaths.canRead(policy, resolved.lexical, resolved.canonical) ||
          !CommandSandboxPaths.canRead(policy, targetPath, resolved.canonical)
        )
          return yield* new CommandSandboxPolicy.Failure({
            code: "unsafe_path",
            message: `Sandbox policy '${policy.profile}' denied read access to ${rawPath ?? targetPath}`,
          })
      }),
    assertWrite: (sessionID: SessionSchema.ID, targetPath: string, rawPath?: string) =>
      Effect.gen(function* () {
        const current = yield* sessions.inspect(sessionID)
        if (CommandSandboxPolicy.isOff(current.policy)) return
        const policy = current.policy
        yield* CommandSandboxPaths.verify(policy)
        const resolved = yield* Effect.tryPromise({
          try: () => CommandSandboxPaths.resolveTarget(rawPath ?? targetPath, policy.workspace),
          catch: (error) =>
            error instanceof CommandSandboxPolicy.Failure
              ? error
              : new CommandSandboxPolicy.Failure({
                  code: "unsafe_path",
                  message: `Sandbox blocked write access to ${rawPath ?? targetPath}`,
                }),
        })
        if (
          !CommandSandboxPaths.canWrite(policy, resolved.lexical, resolved.canonical) ||
          !CommandSandboxPaths.canWrite(policy, targetPath, resolved.canonical)
        )
          return yield* new CommandSandboxPolicy.Failure({
            code: "unsafe_path",
            message: `Sandbox policy '${policy.profile}' denied write access to ${rawPath ?? targetPath}`,
          })
      }),
    filterReadable: <T>(sessionID: SessionSchema.ID, items: ReadonlyArray<T>, getPath: (item: T) => string) =>
      Effect.gen(function* () {
        const current = yield* sessions.inspect(sessionID)
        if (CommandSandboxPolicy.isOff(current.policy)) return [...items]
        const policy = current.policy
        yield* CommandSandboxPaths.verify(policy)
        const kept: T[] = []
        for (const item of items) {
          const raw = getPath(item)
          const resolved = yield* Effect.tryPromise({
            try: () => CommandSandboxPaths.resolveTarget(raw, policy.workspace),
            catch: () => new Error("unresolvable"),
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (resolved && CommandSandboxPaths.canRead(policy, resolved.lexical, resolved.canonical)) {
            kept.push(item)
          }
        }
        return kept
      }),
    assertNetwork: (sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const current = yield* sessions.inspect(sessionID)
        if (CommandSandboxPolicy.isOff(current.policy)) return
        if (current.policy.network !== "unrestricted")
          return yield* new CommandSandboxPolicy.Failure({
            code: "invalid_policy",
            message: `Sandbox policy '${current.policy.profile}' disables network access.`,
          })
      }),
    prepare: (sessionID: SessionSchema.ID, input: { shell: string; command: string; cwd: string }) =>
      Effect.gen(function* () {
        const current = yield* sessions.inspect(sessionID)
        if (CommandSandboxPolicy.isOff(current.policy)) return undefined
        const prepared = yield* prepare(current.policy, input).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              failures.set(current.claim, {
                created: current.created,
                failure: { code: error.code, message: error.message },
              })
            }),
          ),
        )
        return {
          command: prepared.command,
          preview: prepared.preview,
          settle: (result: AppProcess.RunResult) =>
            Effect.gen(function* () {
              const confirmation = prepared.confirm(result)
              if (!confirmation) {
                backend.availability = "unavailable"
                const failure = new CommandSandboxPolicy.Failure({
                  code: "unavailable",
                  message: "The command sandbox launch did not confirm policy application.",
                })
                failures.set(current.claim, { created: current.created, failure })
                return yield* failure
              }
              const active = yield* sessions.inspect(sessionID)
              if (active.created !== current.created)
                return yield* new CommandSandboxPolicy.Failure({
                  code: "identity_conflict",
                  message: "The original command sandbox Session is no longer available.",
                })
              backend.availability = "available"
              failures.delete(current.claim)
              receipts.set(current.claim, {
                created: current.created,
                receipt: {
                  id: randomUUID(),
                  revision: current.policy.revision,
                  backend: backendKind === "bwrap" ? "bwrap" : "seatbelt",
                  confirmedAt: DateTime.makeUnsafe(Date.now()),
                  outcome: "exited",
                  exitCode: result.exitCode,
                },
              })
              return confirmation
            }),
        }
      }),
  }
})

export type Interface = Effect.Success<typeof make>
export class Service extends Context.Service<Service, Interface>()("@apexo/CommandSandbox") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Location.node, Global.node, AppProcess.node, SessionCommandSandbox.node],
})
