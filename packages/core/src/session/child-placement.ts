export * as SessionChildPlacement from "./child-placement"

import path from "node:path"
import { lstat, opendir, realpath } from "node:fs/promises"
import { Context, Effect, Layer, Scope } from "effect"
import { Model } from "@apexo/schema/model"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandSandbox } from "../command-sandbox"
import { makeLocationNode, type LocationNode } from "../effect/app-node"
import { Database } from "../database/database"
import { ProjectTable } from "../project/sql"
import { Git } from "../git"
import { Location } from "../location"
import { SessionChildPlacementAccess } from "./child-placement-access"
import { PermissionV2 } from "../permission"
import { PermissionAuthority } from "../permission/authority"
import { Project } from "../project"
import { ProjectDirectories } from "../project/directories"
import { ProjectCopy } from "../project/copy"
import { AbsolutePath, RelativePath } from "../schema"
import { SessionCommandSandbox } from "./command-sandbox"
import { SessionChildPlacementRecord } from "./child-placement-record"
import { SessionStore } from "./store"
import { SessionSchema } from "./schema"
import { SessionRunnerModel } from "./runner/model"

export const Failure = SessionChildPlacementAccess.Failure
export type Failure = SessionChildPlacementAccess.Failure
export interface Prepared {
  readonly record: SessionChildPlacementRecord.Record
  readonly sandbox: SessionCommandSandbox.Capability
  readonly authority: ReadonlyArray<PermissionAuthority.Snapshot>
  readonly verify: Effect.Effect<void, Failure>
}
export interface Interface {
  readonly capture: (
    source: SessionSchema.Info,
    agent: AgentV2.ID,
  ) => Effect.Effect<ReadonlyArray<PermissionAuthority.Snapshot>, Failure>
  readonly verify: (record: SessionChildPlacementRecord.Record) => Effect.Effect<void, Failure>
  readonly prepare: (input: {
    parent: SessionSchema.Info
    parentAgent: AgentV2.ID
    agent: AgentV2.ID
    inherited: boolean
    model: Model.Ref
    childID: SessionSchema.ID
    sandbox: SessionCommandSandbox.Capability
    saved?: SessionChildPlacementRecord.Record
    cwd?: string
    worktree?: boolean
  }) => Effect.Effect<Prepared | undefined, Failure, Scope.Scope>
}
export class Service extends Context.Service<Service, Interface>()("@apexo/SessionChildPlacement") {}

const make = Effect.gen(function* () {
  const location = yield* Location.Service
  const directories = yield* ProjectDirectories.Service
  const copies = yield* ProjectCopy.Service
  const database = yield* Database.Service
  const projects = yield* Project.Service
  const git = yield* Git.Service
  const permission = yield* PermissionV2.Service
  const sandbox = yield* SessionCommandSandbox.Service
  const sessions = yield* SessionStore.Service
  const safe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError((error) => (error instanceof Failure ? error : new Failure({ message: String(error) }))),
    )
  const identity = (directory: AbsolutePath) =>
    safe(
      Effect.tryPromise(async () => {
        const actual = await realpath(directory)
        const info = await lstat(actual, { bigint: true })
        if (!info.isDirectory() || actual !== directory) throw new Error("Child placement is not a canonical directory")
        return { dev: info.dev.toString(), ino: info.ino.toString() }
      }),
    )
  const verify = (record: SessionChildPlacementRecord.Record) =>
    Effect.gen(function* () {
      const current = yield* identity(record.directory)
      if (current.dev !== record.dev || current.ino !== record.ino)
        return yield* new Failure({ message: "Child placement changed filesystem identity" })
      if (record.repository) {
        const repository = yield* git.repo.discover(record.directory)
        if (!repository || repository.commonDirectory !== record.repository || repository.worktree !== record.directory)
          return yield* new Failure({ message: "Child worktree no longer belongs to its captured repository" })
      }
    })
  const capture = (source: SessionSchema.Info, agent: AgentV2.ID) =>
    safe(
      Effect.gen(function* () {
        if (source.location.directory === location.directory && source.location.workspaceID === location.workspaceID)
          return yield* permission.capture(source.id, agent)
        const access = yield* SessionChildPlacementAccess.Current
        if (!access || access.parentID !== source.parentID)
          return yield* new Failure({ message: "Child placement requires native parent execution ownership" })
        return yield* access.inspect(
          source.location,
          Effect.gen(function* () {
            const target = yield* PermissionV2.Service
            return yield* target.capture(source.id, agent)
          }),
        )
      }),
    )
  return Service.of({
    capture,
    verify,
    prepare: (input) =>
      safe(
        Effect.gen(function* () {
          if (!input.saved && !input.cwd?.trim() && !input.worktree) return undefined
          if (!input.saved && input.cwd?.trim() && input.worktree)
            return yield* new Failure({ message: "Task cwd and worktree isolation cannot be combined" })
          const access = yield* SessionChildPlacementAccess.Current
          if (!access || access.parentID !== input.parent.id)
            return yield* new Failure({ message: "Child placement requires native parent execution ownership" })
          const initial = yield* permission.capture(input.parent.id, input.parentAgent)
          const record =
            input.saved ??
            (yield* Effect.gen(function* () {
              if (input.worktree) {
                const current = yield* projects.resolve(location.project.directory)
                if (current.id !== input.parent.projectID || current.vcs?.type !== "git")
                  return yield* new Failure({ message: "Parent worktree project identity is unavailable" })
                yield* directories.create({ projectID: current.id, directory: current.directory })
              }
              const sourceRepository = input.worktree ? yield* git.repo.discover(location.project.directory) : undefined
              const copiedChanges = sourceRepository
                ? yield* git.change.capture({ repository: sourceRepository, path: location.project.directory })
                : undefined
              const directory = input.worktree
                ? (yield* copies.create({
                    projectID: location.project.id,
                    strategy: ProjectCopy.StrategyID.make("git_worktree"),
                    sourceDirectory: location.project.directory,
                    directory: AbsolutePath.make(
                      path.join(path.dirname(location.project.directory), ".apexo-worktrees"),
                    ),
                    name: input.childID,
                    preserveWorkingTree: true,
                  })).directory
                : AbsolutePath.make(
                    yield* Effect.tryPromise(() => realpath(path.resolve(location.directory, input.cwd!.trim()))),
                  )
              const repository = input.worktree ? yield* git.repo.discover(directory) : undefined
              if (input.worktree && !repository)
                return yield* new Failure({ message: "Child worktree repository is unavailable" })
              const proof = {
                mode: input.worktree ? ("worktree" as const) : ("cwd" as const),
                directory,
                projectID: location.project.id,
                ...(repository
                  ? { repository: repository.commonDirectory, baseRevision: yield* git.history.head(repository) }
                  : {}),
                ...(yield* identity(directory)),
              }
              if (repository) {
                const changes = copiedChanges
                // Register as soon as exact allocation identity is known, before project admission.
                yield* Effect.addFinalizer(() =>
                  Effect.gen(function* () {
                    if (yield* sessions.get(input.childID)) return
                    yield* verify(proof)
                    if (
                      (yield* git.history.head(repository)) !== proof.baseRevision ||
                      (yield* git.change.capture({ repository, path: directory })) !== changes
                    )
                      return
                    const paths = yield* cleanupPaths(directory)
                    if (!paths || (yield* git.index.ignored({ repository, paths })).size > 0) return
                    yield* copies.remove({ projectID: location.project.id, directory, force: true })
                  }).pipe(Effect.catchCause(() => Effect.void)),
                )
              }
              const project = yield* projects.resolve(directory)
              yield* database.db
                .insert(ProjectTable)
                .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
                .onConflictDoNothing()
                .run()
                .pipe(Effect.orDie)
              return { ...proof, projectID: project.id }
            }))
          yield* verify(record)
          const external = record.mode === "cwd" && !inside(location.directory, record.directory)
          if (external)
            yield* permission.assert({
              sessionID: input.parent.id,
              agent: input.parentAgent,
              action: "external_directory",
              resources: [record.directory],
              save: [record.directory],
            })
          const admitted = yield* permission.capture(input.parent.id, input.parentAgent)
          const profile = (yield* sandbox.get(input.parent.id)).profile
          const inspect = access.inspect(
            { directory: record.directory },
            Effect.gen(function* () {
              const agents = yield* AgentV2.Service
              const models = yield* SessionRunnerModel.Service
              const catalog = yield* Catalog.Service
              const command = yield* CommandSandbox.Service
              const targetPermission = yield* PermissionV2.Service
              const agent = yield* agents.resolve(input.agent)
              if (!agent || agent.hidden || (!input.inherited && agent.mode === "primary"))
                return yield* new Failure({ message: "Selected child agent is unavailable in its placement" })
              if (!(yield* catalog.model.get(input.model.providerID, input.model.id)))
                return yield* new Failure({ message: "Saved child model is unavailable in its placement" })
              yield* models.resolve({ ...input.parent, agent: input.agent, model: input.model })
              return {
                policy: yield* command.preflight(profile),
                authority: yield* targetPermission.capture(input.parent.id, agent.id),
              }
            }),
          )
          const target = yield* inspect
          const derived = yield* sandbox.derive(input.sandbox, target.policy)
          return {
            record,
            sandbox: derived,
            authority: [
              ...initial,
              ...translate(initial, location.directory, record.directory),
              ...target.authority,
              ...translate(target.authority, location.directory, record.directory),
            ],
            verify: safe(
              Effect.gen(function* () {
                yield* verify(record)
                const fresh = yield* inspect
                if (JSON.stringify(fresh) !== JSON.stringify(target))
                  return yield* new Failure({ message: "Target authority or sandbox changed during child placement" })
                const current = yield* permission.capture(input.parent.id, input.parentAgent)
                if (
                  external &&
                  (yield* permission.inspect(input.parent.id, input.parentAgent))("external_directory", [
                    record.directory,
                  ]) === "deny"
                )
                  return yield* new Failure({ message: "External child placement permission was revoked" })
                if (JSON.stringify(current) !== JSON.stringify(admitted))
                  return yield* new Failure({ message: "Parent authority changed during child placement" })
              }),
            ),
          }
        }),
      ),
  })
})
// Cleanup inspects names only, never traverses symlinks, and retains unknown/large allocations.
function cleanupPaths(directory: AbsolutePath) {
  return Effect.tryPromise(async () => {
    const pending = [""]
    const paths: RelativePath[] = []
    while (pending.length) {
      const relative = pending.pop()!
      for await (const entry of await opendir(path.join(directory, relative), { bufferSize: 32 })) {
        if (!relative && entry.name === ".git") continue
        if (entry.isSymbolicLink() || paths.length >= 1024) return undefined
        const name = path.join(relative, entry.name)
        paths.push(RelativePath.make(name))
        if (entry.isDirectory()) pending.push(name)
      }
    }
    return paths
  })
}
function translate(snapshots: ReadonlyArray<PermissionAuthority.Snapshot>, source: string, target: string) {
  const rules = (values: PermissionAuthority.Snapshot["rules"]) =>
    values.map((rule) => ({
      ...rule,
      resource:
        rule.resource === source || rule.resource.startsWith(`${source}${path.sep}`)
          ? `${target}${rule.resource.slice(source.length)}`
          : rule.resource,
    }))
  return snapshots.map((snapshot) => ({ rules: rules(snapshot.rules), all: rules(snapshot.all) }))
}
function inside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
export const node: LocationNode<Service> = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [
    Location.node,
    ProjectCopy.node,
    ProjectDirectories.node,
    Project.node,
    Database.node,
    Git.node,
    PermissionV2.node,
    SessionCommandSandbox.node,
    SessionStore.node,
  ],
})
