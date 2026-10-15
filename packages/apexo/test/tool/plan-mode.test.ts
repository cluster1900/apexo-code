import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { expect } from "bun:test"
import { Effect, Fiber, Queue } from "effect"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { ToolRegistry } from "@/tool/registry"
import { GrokBuildTools } from "@/tool/grok-build"
import { PlanEnter } from "@/tool/plan-enter"
import { PlanExitTool } from "@/tool/plan"
import { Tool } from "@/tool/tool"
import { Session } from "@/session/session"
import { Question } from "@/question"
import { EventV2Bridge } from "@/event-v2-bridge"
import { MessageID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { Provider } from "@/provider/provider"
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"
import { SessionProjector } from "@apexo/core/session/projector"

const it = testEffect(
  AppNodeBuilderV1.build(
    LayerNode.group([
      ToolRegistry.node,
      Session.node,
      SessionProjector.node,
      Question.node,
      Provider.node,
      EventV2Bridge.node,
      Truncate.node,
      Agent.node,
    ]),
  ),
)

for (const approved of [false, true]) {
  it.instance(`plan exit ${approved ? "approval resumes build" : "rejection preserves plan"}`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const questions = yield* Question.Service
      const events = yield* EventV2Bridge.Service
      const session = yield* sessions.create({ title: "Plan regression" })
      const messageID = MessageID.ascending()
      yield* sessions.updateMessage({
        id: messageID,
        sessionID: session.id,
        role: "user",
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
        time: { created: Date.now() },
      })
      const enter = yield* PlanEnter.PlanEnterTool
      const leave = yield* PlanExitTool
      const tools = GrokBuildTools.adaptTools([yield* Tool.init(enter), yield* Tool.init(leave)])
      const context: Tool.Context = {
        sessionID: session.id,
        messageID,
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }
      yield* tools.find((tool) => tool.id === "enter_plan_mode")!.execute({}, context)
      expect((yield* sessions.messages({ sessionID: session.id })).at(-1)?.info).toMatchObject({
        role: "user",
        agent: "plan",
      })
      const pending = yield* Queue.unbounded<void>()
      const off = yield* events.listen((event) => {
        if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(pending, undefined)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)
      const exit = yield* tools
        .find((tool) => tool.id === "exit_plan_mode")!
        .execute({}, { ...context, agent: "plan" })
        .pipe(Effect.forkScoped)
      yield* Queue.take(pending).pipe(Effect.timeout("5 seconds"))
      const request = (yield* questions.list())[0]
      yield* questions.reply({ requestID: request.id, answers: [[approved ? "Yes" : "No"]] })
      expect((yield* Fiber.await(exit))._tag).toBe(approved ? "Success" : "Failure")
      expect((yield* sessions.messages({ sessionID: session.id })).at(-1)?.info).toMatchObject({
        role: "user",
        agent: approved ? "build" : "plan",
      })
    }),
  )
}
