export * as SessionChildPlacement from "./child-placement"

import path from "node:path"
import { lstat, mkdir, opendir, realpath, rm } from "node:fs/promises"
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
  readonly snapshot: (
    record: SessionChildPlacementRecord.Record,
  ) => Effect.Effect<SessionChildPlacementRecord.Record, Failure>
  readonly recover: (
    record: SessionChildPlacementRecord.Record,
  ) => Effect.Effect<SessionChildPlacementRecord.Record, Failure>
  readonly prepare: (input: {
    parent: SessionSchema.Info
    parentAgent: AgentV2.ID
    agent: AgentV2.ID
    inherited: boolean
    model: Model.Ref
    childID: SessionSchema.ID
    sandbox: SessionCommandSandbox.Capability
    saved?: SessionChildPlacementRecord.Record
    recoverSaved?: boolean
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
  const verifyRepository = (record: SessionChildPlacementRecord.Record) =>
    Effect.gen(function* () {
      const current = yield* identity(record.directory)
      if (current.dev !== record.dev || current.ino !== record.ino)
        return yield* new Failure({ message: "Child placement changed filesystem identity" })
      if (!record.repository) return undefined
      if (record.repositoryDev !== undefined && record.repositoryIno !== undefined) {
        const repositoryIdentity = yield* identity(record.repository)
        if (repositoryIdentity.dev !== record.repositoryDev || repositoryIdentity.ino !== record.repositoryIno)
          return yield* new Failure({ message: "Child worktree repository changed filesystem identity" })
      }
      const repository = yield* git.repo.discover(record.directory)
      if (!repository || repository.commonDirectory !== record.repository || repository.worktree !== record.directory)
        return yield* new Failure({ message: "Child worktree no longer belongs to its captured repository" })
      return repository
    })
  const verify = (record: SessionChildPlacementRecord.Record) => verifyRepository(record).pipe(Effect.asVoid)
  const snapshot = (record: SessionChildPlacementRecord.Record) =>
    safe(
      Effect.gen(function* () {
        if (record.mode !== "worktree") return record
        const repository = yield* verifyRepository(record)
        if (!repository)
          return yield* new Failure({ message: "Child worktree no longer belongs to its captured repository" })
        const baseRevision = yield* git.history.head(repository)
        if (!baseRevision) return yield* new Failure({ message: "Child worktree HEAD is unavailable" })
        const changes = yield* git.change.capture({ repository, path: record.directory })
        const current = yield* identity(record.directory)
        if (current.dev !== record.dev || current.ino !== record.ino)
          return yield* new Failure({ message: "Child placement changed filesystem identity" })
        if (record.repository && record.repositoryDev !== undefined && record.repositoryIno !== undefined) {
          const repositoryIdentity = yield* identity(record.repository)
          if (repositoryIdentity.dev !== record.repositoryDev || repositoryIdentity.ino !== record.repositoryIno)
            return yield* new Failure({ message: "Child worktree repository changed filesystem identity" })
        }
        if ((yield* git.history.head(repository)) !== baseRevision)
          return yield* new Failure({ message: "Child worktree changed during snapshot capture" })
        return {
          ...record,
          baseRevision,
          changes,
        } satisfies SessionChildPlacementRecord.Record
      }),
    )
  const recover = (record: SessionChildPlacementRecord.Record) =>
    safe(
      Effect.gen(function* () {
        const stat = yield* Effect.tryPromise(async () => {
          try {
            return await lstat(record.directory, { bigint: true })
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined
            throw error
          }
        })
        if (stat !== undefined) {
          yield* verify(record)
          return record
        }
        if (record.mode !== "worktree")
          return yield* new Failure({ message: "Deleted cwd child placement cannot be reconstructed" })
        if (
          !record.repository ||
          record.repositoryDev === undefined ||
          record.repositoryIno === undefined ||
          !record.baseRevision ||
          record.changes === undefined
        )
          return yield* new Failure({ message: "Deleted child worktree has no complete snapshot receipt" })
        const access = yield* SessionChildPlacementAccess.Current
        if (!access)
          return yield* new Failure({ message: "Child placement requires native parent execution ownership" })
        const currentProject = yield* projects.resolve(location.project.directory)
        if (
          currentProject.id !== location.project.id ||
          currentProject.id !== record.projectID ||
          currentProject.vcs?.type !== "git"
        )
          return yield* new Failure({ message: "Parent worktree project identity is unavailable" })
        const sourceRepository = yield* git.repo.discover(location.project.directory)
        if (!sourceRepository || sourceRepository.commonDirectory !== record.repository)
          return yield* new Failure({ message: "Child worktree no longer belongs to its captured repository" })
        const repositoryIdentity = yield* identity(record.repository)
        if (repositoryIdentity.dev !== record.repositoryDev || repositoryIdentity.ino !== record.repositoryIno)
          return yield* new Failure({ message: "Child worktree repository changed filesystem identity" })
        const projectParent = AbsolutePath.make(path.dirname(location.project.directory))
        yield* identity(projectParent)
        const worktreesRoot = AbsolutePath.make(path.join(projectParent, ".apexo-worktrees"))
        if (path.dirname(record.directory) !== worktreesRoot || !path.basename(record.directory))
          return yield* new Failure({ message: "Child worktree path is outside the managed worktrees root" })
        const rootStat = yield* Effect.tryPromise(async () => {
          try {
            return await lstat(worktreesRoot, { bigint: true })
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined
            throw error
          }
        })
        if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink()))
          return yield* new Failure({ message: "Managed worktrees root is not a canonical directory" })
        yield* Effect.tryPromise(() => mkdir(worktreesRoot, { recursive: true }))
        yield* identity(worktreesRoot)
        yield* git.worktree
          .remove({ repository: sourceRepository, directory: record.directory, force: true })
          .pipe(Effect.catch(() => Effect.void))
        const created = yield* git.worktree.create({
          repository: sourceRepository,
          directory: record.directory,
          revision: record.baseRevision,
        })
        const applied = yield* Effect.gen(function* () {
          if (record.changes && record.changes.length > 0)
            yield* git.change.apply({
              repository: created,
              path: record.directory,
              changes: Git.ChangeSet.make(record.changes),
            })
          if (
            created.commonDirectory !== record.repository ||
            created.worktree !== record.directory ||
            (yield* git.history.head(created)) !== record.baseRevision
          )
            return yield* new Failure({ message: "Reconstructed child worktree did not match its snapshot receipt" })
          const resolvedProject = yield* projects.resolve(record.directory)
          if (resolvedProject.id !== record.projectID || resolvedProject.vcs?.type !== "git")
            return yield* new Failure({ message: "Reconstructed child worktree project identity changed" })
          const current = yield* identity(record.directory)
          const recovered: SessionChildPlacementRecord.Record = {
            ...record,
            dev: current.dev,
            ino: current.ino,
          }
          yield* verify(recovered)
          return recovered
        }).pipe(
          Effect.tapError(() =>
            git.worktree
              .remove({ repository: sourceRepository, directory: record.directory, force: true })
              .pipe(
                Effect.catch(() => Effect.void),
                Effect.andThen(
                  Effect.tryPromise(() => rm(record.directory, { recursive: true, force: true })).pipe(
                    Effect.catch(() => Effect.void),
                  ),
                ),
              ),
          ),
        )
        yield* directories.create({
          projectID: applied.projectID,
          directory: applied.directory,
          strategy: ProjectCopy.StrategyID.make("git_worktree"),
          behavior: "replace",
        })
        return applied
      }),
    )
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
    snapshot,
    recover,
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
          const record = input.saved
            ? input.recoverSaved
              ? yield* recover(input.saved)
              : input.saved
            : yield* Effect.gen(function* () {
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
                const baseRevision = repository ? yield* git.history.head(repository) : undefined
                const repositoryIdentity = repository ? yield* identity(repository.commonDirectory) : undefined
                if (input.worktree && (!repository || !baseRevision || !repositoryIdentity || copiedChanges === undefined))
                  return yield* new Failure({ message: "Child worktree repository is unavailable" })
                const proof: SessionChildPlacementRecord.Record = {
                  mode: input.worktree ? ("worktree" as const) : ("cwd" as const),
                  directory,
                  projectID: location.project.id,
                  ...(repository && baseRevision && repositoryIdentity && copiedChanges !== undefined
                    ? {
                        repository: repository.commonDirectory,
                        repositoryDev: repositoryIdentity.dev,
                        repositoryIno: repositoryIdentity.ino,
                        baseRevision,
                        changes: copiedChanges,
                      }
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
              })
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
