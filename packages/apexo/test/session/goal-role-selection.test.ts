import { expect } from "bun:test"
import path from "node:path"
import { Effect, Layer, Schema } from "effect"
import { Goal } from "@apexo/schema/goal"
import { AbsolutePath } from "@apexo/schema/schema"
import { AgentV2 } from "@apexo/core/agent"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionV2 } from "@apexo/core/session"
import { SessionStore } from "@apexo/core/session/store"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionGoalRoleSelection } from "@apexo/core/session/goal-role-selection"
import { Tool } from "@apexo/core/tool/tool"
import { ToolRegistry } from "@apexo/core/tool/registry"
import { tmpdirScoped } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.merge(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const app = (root: string) =>
  AppNodeBuilder.build(
    LayerNode.group([SessionV2.node, SessionStore.node, LocationServiceMap.node, LocationRuntimeGuard.node]),
    [
      [
        Global.node,
        Layer.succeed(Global.Service)(
          Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
        ),
      ],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  )
const cases: ReadonlyArray<{
  name: string
  requested?: Goal.RoleModel
  fallback?: Goal.RoleExecution["fallback"]
  selected?: boolean
  implicit?: boolean
  registration?: boolean
  parentDeny?: boolean
  sessionRule?: "deny" | "allow"
}> = [
  { name: "omitted pair preserves the current model and agent" },
  {
    name: "available pair selects both requested components",
    requested: { model: "fixture/role", agent_type: "reviewer" },
    selected: true,
  },
  {
    name: "unknown agent discards its otherwise valid requested model",
    requested: { model: "fixture/role", agent_type: "missing" },
    fallback: "agent_unavailable",
  },
  {
    name: "text-only model is unavailable to a tool-dependent role",
    requested: { model: "fixture/no-tools", agent_type: "reviewer" },
    fallback: "model_unavailable",
  },
  {
    name: "parent agent denial cannot be widened by a capable role or Session allowance",
    requested: { model: "fixture/role", agent_type: "reviewer" },
    fallback: "agent_incapable",
    parentDeny: true,
    sessionRule: "allow",
  },
  {
    name: "inherited Session denial prevents a false capability claim",
    requested: { model: "fixture/role", agent_type: "reviewer" },
    fallback: "agent_incapable",
    sessionRule: "deny",
  },
  {
    name: "unknown model discards its otherwise valid requested agent",
    requested: { model: "fixture/missing", agent_type: "reviewer" },
    fallback: "model_unavailable",
  },
  {
    name: "agent without read falls back before creating a child",
    requested: { model: "fixture/role", agent_type: "no-read" },
    fallback: "agent_incapable",
  },
  {
    name: "agent without grep falls back before creating a child",
    requested: { model: "fixture/role", agent_type: "no-grep" },
    fallback: "agent_incapable",
  },
  {
    name: "short model ID resolves against the actual implicit current provider",
    requested: { model: "role", agent_type: "reviewer" },
    selected: true,
    implicit: true,
  },
  {
    name: "canonical registration permissions determine role capability",
    requested: { model: "fixture/role", agent_type: "custom-denied" },
    fallback: "agent_incapable",
    registration: true,
  },
]
for (const scenario of cases)
  it.live(`native Goal role preflight: ${scenario.name}`, () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const directory = path.join(root, "project")
      const llm = yield* TestLLMServer
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            model: "fixture/current",
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            agents: {
              ...(scenario.parentDeny
                ? { build: { permissions: [{ action: "read", resource: "*", effect: "deny" }] } }
                : {}),
              reviewer: { mode: "subagent", permissions: [{ action: "edit", resource: "*", effect: "deny" }] },
              "no-read": { mode: "subagent", permissions: [{ action: "read", resource: "*", effect: "deny" }] },
              "no-grep": { mode: "subagent", permissions: [{ action: "grep", resource: "*", effect: "deny" }] },
              "custom-denied": {
                mode: "subagent",
                permissions: [{ action: "custom_read", resource: "*", effect: "deny" }],
              },
            },
            providers: {
              fixture: {
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "test" },
                },
                models: Object.fromEntries(
                  ["current", "role", "no-tools"].map((name) => [
                    name,
                    {
                      name,
                      capabilities: { tools: name !== "no-tools", input: ["text"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  ]),
                ),
              },
            },
          }),
        ),
      )
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const store = yield* SessionStore.Service
        const guard = yield* LocationRuntimeGuard.Service
        const session = yield* sessions.create({
          location: { directory: AbsolutePath.make(directory) },
          agent: AgentV2.ID.make("build"),
          ...(!scenario.implicit
            ? { model: { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("current") } }
            : {}),
        })
        if (scenario.sessionRule)
          yield* store.setPermissions({
            sessionID: session.id,
            permissions: [{ permission: "read", pattern: "*", action: scenario.sessionRule }],
          })
        const inherited = ((yield* store.permissions(session.id)) ?? []).map((rule) => ({
          action: rule.permission,
          resource: rule.pattern,
          effect: rule.action,
        }))
        yield* guard.use(
          session.location,
          Effect.gen(function* () {
            const agents = yield* AgentV2.Service
            const tools = yield* ToolRegistry.Service
            if (scenario.registration)
              yield* tools.register({
                read: Tool.withPermission(
                  Tool.make({
                    description: "Preflight-only registered read tool",
                    input: Schema.Struct({}),
                    output: Schema.String,
                    execute: () => Effect.die("Preflight must not execute a tool"),
                  }),
                  "custom_read",
                ),
              })
            const parent = yield* agents.select(session.agent)
            const select = yield* SessionGoalRoleSelection.make
            const selection = yield* select(session, parent, scenario.requested, inherited)
            expect(selection.execution.agent).toBe(AgentV2.ID.make(scenario.selected ? "reviewer" : "build"))
            expect(selection.execution.model).toEqual({
              providerID: ProviderV2.ID.make("fixture"),
              id: ModelV2.ID.make(scenario.selected ? "role" : "current"),
              ...(!scenario.selected && session.model?.variant ? { variant: session.model.variant } : {}),
            })
            expect(selection.execution.requested).toEqual(scenario.requested)
            expect(selection.execution.fallback).toBe(scenario.fallback)
            expect(selection.agent.id).toBe(selection.execution.agent)
            expect(selection.agent.info?.permissions).toEqual(
              (scenario.selected ? yield* agents.get(AgentV2.ID.make("reviewer")) : parent.info)?.permissions,
            )
            expect(yield* llm.calls).toBe(0)
          }).pipe(Effect.provide(locations.get(session.location))),
        )
      }).pipe(Effect.provide(app(root)))
    }),
  )
