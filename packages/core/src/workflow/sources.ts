export * as WorkflowSources from "./sources"

import path from "node:path"
import { Context, Effect, FileSystem, Layer } from "effect"
import { Workflow } from "@apexo/schema/workflow"
import { SessionID } from "@apexo/schema/session-id"
import { filesystem } from "../effect/app-node-platform"
import { makeLocationNode } from "../effect/app-node"
import { Global } from "../global"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { SessionStore } from "../session/store"
import { AgentV2 } from "../agent"
import { WorkflowStore } from "./store"
import { WorkflowDefinition } from "./definition"
import { WorkflowInterpreter } from "./interpreter"
import { AppProcess } from "../process"

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const processes = yield* AppProcess.Service
  const global = yield* Global.Service
  const location = yield* Location.Service
  const permission = yield* PermissionV2.Service
  const sessions = yield* SessionStore.Service
  const agents = yield* AgentV2.Service
  const roots = [path.join(location.directory, ".apexo", "workflows"), path.join(global.config, "workflows")]
  const resolve = (sessionID: SessionID, source: Workflow.Source) =>
    Effect.gen(function* () {
      if (source.type !== "saved") return source
      const parent = yield* sessions.get(sessionID)
      if (!parent)
        return yield* new WorkflowStore.Failure({ code: "missing", message: "Workflow Session does not exist" })
      const agent = yield* agents.select(parent.agent)
      for (const root of roots) {
        const file = path.join(root, `${source.name}.rhai`)
        if (!(yield* fs.exists(file))) continue
        yield* permission.assert({ action: "read", resources: [file], save: [file], sessionID, agent: agent.id })
        const resolved = yield* fs.realPath(file)
        yield* permission.assert({
          action: "read",
          resources: [resolved],
          save: [resolved],
          sessionID,
          agent: agent.id,
        })
        const stat = yield* fs.stat(resolved)
        if (Number(stat.size) > 512_000)
          return yield* new WorkflowStore.Failure({ code: "invalid", message: "Saved workflow exceeds its size limit" })
        return { type: "script" as const, name: source.name, script: yield* fs.readFileString(resolved) }
      }
      return yield* new WorkflowStore.Failure({
        code: "missing",
        message: "Saved workflow was not found in project or user workflows",
      })
    }).pipe(
      Effect.mapError((error) =>
        error instanceof WorkflowStore.Failure
          ? error
          : new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
      ),
    )
  const list = (sessionID: SessionID) =>
    Effect.gen(function* () {
      const parent = yield* sessions.get(sessionID)
      if (!parent)
        return yield* new WorkflowStore.Failure({ code: "missing", message: "Workflow Session does not exist" })
      const agent = yield* agents.select(parent.agent)
      const entries: Workflow.SourceEntry[] = [
        {
          name: "deep-research",
          scope: "builtin",
          description: "Plan, research, independently verify, and report cited evidence",
        },
      ]
      const seen = new Set<string>()
      for (const [index, root] of roots.entries()) {
        if (!(yield* fs.exists(root))) continue
        yield* permission.assert({ action: "read", resources: [root], save: [root], sessionID, agent: agent.id })
        const resolved = yield* fs.realPath(root)
        yield* permission.assert({
          action: "read",
          resources: [resolved],
          save: [resolved],
          sessionID,
          agent: agent.id,
        })
        const names = yield* fs.readDirectory(resolved)
        if (names.length > 1000)
          return yield* new WorkflowStore.Failure({
            code: "invalid",
            message: "Workflow source directory exceeds 1000 entries",
          })
        for (const name of names.toSorted()) {
          if (!/^[a-z][a-z0-9-]{0,63}\.rhai$/.test(name)) continue
          const key = name.slice(0, -5)
          if (seen.has(key)) continue
          const file = path.join(root, name)
          yield* permission.assert({ action: "read", resources: [file], save: [file], sessionID, agent: agent.id })
          const target = yield* fs.realPath(file)
          yield* permission.assert({ action: "read", resources: [target], save: [target], sessionID, agent: agent.id })
          if ((yield* fs.stat(target)).type !== "File") continue
          seen.add(key)
          entries.push({ name: key, scope: index === 0 ? "project" : "user" })
        }
      }
      return entries
    }).pipe(
      Effect.mapError((error) =>
        error instanceof WorkflowStore.Failure
          ? error
          : new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
      ),
    )
  const validate = (sessionID: SessionID, source: Workflow.Source) =>
    Effect.gen(function* () {
      const selected = yield* resolve(sessionID, source)
      const definition = yield* Effect.try({
        try: () => WorkflowDefinition.resolve(selected),
        catch: (error) => new WorkflowStore.Failure({ code: "invalid", message: String(error) }),
      })
      if (selected.type !== "script") return { name: definition.name, valid: true, diagnostics: [] }
      return { name: definition.name, ...(yield* WorkflowInterpreter.validate(processes, fs, selected.script)) }
    })
  return { resolve, list, validate }
})
export class Service extends Context.Service<Service, Effect.Success<typeof make>>()("@apexo/WorkflowSources") {}
export const node = makeLocationNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [filesystem, AppProcess.node, Global.node, Location.node, PermissionV2.node, SessionStore.node, AgentV2.node],
})
