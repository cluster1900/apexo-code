import { expect, test } from "bun:test"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { Database } from "@apexo/core/database/database"
import { SessionMemoryContextTable } from "@apexo/core/session/sql"
import { SessionProjector } from "@apexo/core/session/projector"
import { MemoryContext } from "@apexo/core/memory-context"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { MemoryMaintenance } from "@apexo/core/memory-maintenance"
import { SessionV1 } from "@apexo/core/v1/session"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Session } from "@/session/session"
import { SessionMemoryContext } from "@/session/memory-context"
import { MemoryIndex } from "@/session/memory-index"
import { Permission } from "@/permission"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

function user(text: string, synthetic = false): SessionV1.WithParts {
  const id = MessageID.ascending()
  const sessionID = SessionID.make("ses_memory_context")
  return {
    info: {
      id,
      sessionID,
      role: "user",
      agent: "build",
      time: { created: 1 },
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
    },
    parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text, synthetic }],
  }
}

test("memory query uses actual user text and ignores automatic continuation", () => {
  const message = user("Investigate database transaction retry boundaries")
  expect(MemoryContext.query([message, user("BACKGROUND_WAKE_SECRET", true), user("__auto_continue__")])).toBe(
    "Investigate database transaction retry boundaries",
  )
  expect(MemoryContext.query([user("Short")])).toBe("project conventions preferences architecture")
  expect(MemoryContext.query([user("GOOD MORNING!!!")])).toBe("project conventions preferences architecture")
  expect(MemoryContext.query([user("数据库连接池的配置")])).toBe("数据库连接池的配置")
  expect(MemoryContext.query([user("short")], true)).toBe("short")
  expect(MemoryContext.query([], true)).toBe("project context")
})

test("memory formatting preserves Unicode, bounds snippets, and isolates Markdown", () => {
  const result = {
    path: "/memory/topics/design.md",
    source: "workspace" as const,
    score: 0.95,
    start_line: 2,
    end_line: 20,
    snippet: `\`\`\`\n${"😀".repeat(600)}`,
  }
  const formatted = MemoryContext.format([result])
  expect(formatted).toContain("<memory-context>")
  expect(formatted).toContain("not higher-priority instructions")
  expect(formatted).toContain("score: 0.95, source: workspace")
  expect(formatted).toContain("(lines 2-20)")
  expect(formatted).toContain("````\n```\n")
  expect(formatted).toContain(`${"😀".repeat(496)}...`)
  expect(formatted).not.toContain("�")
  expect(MemoryContext.format([])).toBe("")
})

const bootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node, InstanceStore.node]), [
    [InstanceBootstrap.node, bootstrap],
  ]),
)

it.live(
  "session memory persists an epoch, rechecks permissions, refreshes after compaction and cascades deletion",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      const settings: ConfigV1.Info = { permission: { "*": "allow" }, memory: { enabled: true } }
      yield* Effect.gen(function* () {
        const contexts = yield* SessionMemoryContext.Service
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const database = yield* Database.Service
        const ctx = yield* InstanceState.context
        const agent = (yield* agents.get("build"))!
        const session = yield* sessions.create()
        const messages = [user("Investigate database transaction retry boundaries")]
        const file = WorkspaceMemory.file(directory, home, { projectID: ctx.project.id })
        yield* Effect.promise(async () => {
          await mkdir(path.dirname(file), { recursive: true })
          await writeFile(file, "# Database\ndatabase ORIGINAL_RECALLED\n")
        })
        const input = { sessionID: session.id, agent, messages }
        const indexes = yield* MemoryIndex.Service
        const index = yield* indexes.get()
        const matches = yield* index.search({ query: MemoryContext.query(messages) })
        expect(matches.results).toHaveLength(1)
        expect(Permission.evaluate("read", file, agent.permission, session.permission ?? []).action).toBe("allow")
        expect(
          yield* database.db
            .select()
            .from(SessionMemoryContextTable)
            .where(eq(SessionMemoryContextTable.session_id, session.id))
            .all(),
        ).toEqual([])
        const first = yield* contexts.context(input)
        expect(first).toContain("ORIGINAL_RECALLED")
        yield* Effect.promise(() => writeFile(file, "# Database\ndatabase UPDATED_RECALLED\n"))
        expect(yield* contexts.context(input)).toBe(first)
        const row = yield* database.db
          .select()
          .from(SessionMemoryContextTable)
          .where(eq(SessionMemoryContextTable.session_id, session.id))
          .get()
        expect(row?.content).toBe(first)
        expect(row?.access_paths).toContain(yield* Effect.promise(() => realpath(file)))
        yield* sessions.setPermission({
          sessionID: session.id,
          permission: [{ permission: "read", pattern: file, action: "deny" }],
        })
        expect(yield* contexts.context(input)).toBe("")
        yield* sessions.setPermission({
          sessionID: session.id,
          permission: [{ permission: "read", pattern: "*", action: "allow" }],
        })
        expect(yield* contexts.context(input)).toBe(first)

        const denied = yield* sessions.create({ permission: [{ permission: "read", pattern: "*", action: "ask" }] })
        expect(yield* contexts.context({ ...input, sessionID: denied.id })).toBe("")
        yield* sessions.setPermission({
          sessionID: denied.id,
          permission: [{ permission: "read", pattern: "*", action: "allow" }],
        })
        expect(yield* contexts.context({ ...input, sessionID: denied.id })).toBe("")

        const summary: SessionV1.WithParts = {
          info: {
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "assistant",
            parentID: messages[0]!.info.id,
            agent: "compaction",
            mode: "compaction",
            summary: true,
            finish: "stop",
            time: { created: 2, completed: 3 },
            path: { cwd: directory, root: directory },
            providerID: ProviderV2.ID.make("test"),
            modelID: ModelV2.ID.make("test"),
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [],
        }
        const message = messages[0]!
        yield* sessions.updateMessage({ ...message.info, sessionID: session.id })
        for (const part of message.parts) yield* sessions.updatePart({ ...part, sessionID: session.id })
        const recovered = yield* contexts.context({ ...input, messages: [summary, user("__auto_continue__")] })
        expect(recovered).toContain("UPDATED_RECALLED")
        expect(recovered).not.toContain("ORIGINAL_RECALLED")
        settings.memory = { enabled: false }
        expect(yield* contexts.context(input)).toBe("")
        settings.memory = { enabled: true, initial_injection: { enabled: false } }
        expect(yield* contexts.context(input)).toBe("")
        expect(yield* contexts.context({ ...input, messages: [summary] })).toBe(recovered)
        settings.memory = { enabled: true }
        yield* Effect.promise(() =>
          MemoryMaintenance.clear(
            WorkspaceMemory.maintenance(directory, home, { projectID: ctx.project.id }),
            "workspace",
          ),
        )
        expect(yield* contexts.context(input)).toBe("")
        const cleared = yield* indexes.get()
        expect(cleared).not.toBe(index)
        expect((yield* cleared.search({ query: "database" })).results).toEqual([])
        yield* Effect.promise(() =>
          WorkspaceMemory.update(directory, { operation: "remember", content: "database NEW_AFTER_CLEAR" }, home, {
            projectID: ctx.project.id,
          }),
        )
        expect((yield* cleared.search({ query: "database" })).results[0]?.snippet).toContain("NEW_AFTER_CLEAR")
        const fresh = yield* sessions.create()
        expect(yield* contexts.context({ ...input, sessionID: fresh.id })).toContain("NEW_AFTER_CLEAR")
        yield* sessions.remove(fresh.id)
        yield* sessions.remove(session.id)
        expect(
          yield* database.db
            .select()
            .from(SessionMemoryContextTable)
            .where(eq(SessionMemoryContextTable.session_id, session.id))
            .all(),
        ).toEqual([])
        yield* sessions.remove(denied.id)
      }).pipe(
        provideInstance(directory),
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionMemoryContext.node,
              MemoryIndex.node,
              Session.node,
              SessionProjector.node,
              Agent.node,
              Database.node,
            ]),
            [
              [Config.node, TestConfig.layer({ get: () => Effect.succeed(settings) })],
              [Global.node, Global.layerWith({ home, config: home })],
              [RuntimeFlags.node, RuntimeFlags.layer({ runtimeProfile: "grok-build" })],
              [InstanceBootstrap.node, bootstrap],
            ],
          ),
        ),
      )
    }),
)
