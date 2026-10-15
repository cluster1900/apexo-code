import { expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { AgentV2 } from "@apexo/core/agent"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionProcess } from "@apexo/schema/session-process"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionProcessStore } from "@apexo/core/session/process-store"
import { SessionProcessTable } from "@apexo/core/session/process.sql"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live(
  "process receipts own exact invocations, terminal ordering, snapshots, restart refusal and incarnation cleanup",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      return yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const database = yield* Database.Service
        const processes = yield* SessionProcessStore.Service
        const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const foreign = yield* sessions.create({ location: session.location })
        const request: SessionProcessStore.Request = {
          agent: AgentV2.ID.make("build"),
          command: "printf receipt",
          shell: "/bin/sh",
          cwd: directory,
          description: "Receipt fixture",
          waitMs: 0,
          timeoutMs: 1000,
        }
        const invocation = { sessionID: session.id, messageID: SessionMessage.ID.create(), callID: "call-one", request }
        const first = yield* processes.begin(invocation)
        expect(first.created).toBe(true)
        expect(first.record.spawned).toBe(false)
        expect((yield* processes.started(session.id, first.record.id)).spawned).toBe(true)
        expect(first.record.id.startsWith("proc_")).toBe(true)
        expect(Schema.is(SessionProcess.ID)(first.record.id)).toBe(true)
        expect(Schema.is(SessionProcess.ID)(session.id)).toBe(false)
        const retry = yield* processes.begin(invocation)
        expect(retry.created).toBe(false)
        expect(retry.record.id).toBe(first.record.id)
        expect(
          (yield* processes.begin({
            ...invocation,
            request: {
              agent: request.agent,
              timeoutMs: request.timeoutMs,
              waitMs: request.waitMs,
              description: request.description,
              shell: request.shell,
              cwd: request.cwd,
              command: request.command,
            },
          })).created,
        ).toBe(false)
        expect(
          (yield* processes.begin({ ...invocation, request: { ...request, command: "different" } }).pipe(Effect.result))
            ._tag,
        ).toBe("Failure")
        yield* Effect.forEach(
          [
            { ...request, agent: AgentV2.ID.make("other") },
            { ...request, cwd: directory + "/other" },
            { ...request, shell: "/bin/other" },
            { ...request, description: "different intent" },
            { ...request, waitMs: 10 },
            { ...request, timeoutMs: 999 },
          ],
          (request) =>
            processes.begin({ ...invocation, request }).pipe(
              Effect.result,
              Effect.tap((result) =>
                Effect.sync(() => {
                  expect(result._tag).toBe("Failure")
                  if (result._tag === "Failure") expect(result.failure.code).toBe("invalid")
                }),
              ),
            ),
        )
        expect((yield* processes.owned(foreign.id, first.record.id).pipe(Effect.result))._tag).toBe("Failure")
        expect(yield* processes.notice(session.id, first.record.id, "pending")).toBe(false)
        yield* processes.snapshot(session.id, first.record.id, "partial😀", false)
        expect((yield* processes.output(session.id, first.record.id)).output).toBe("partial😀")
        expect(
          (yield* processes
            .snapshot(session.id, first.record.id, "😀".repeat(SessionProcessStore.MAX_OUTPUT_BYTES), false)
            .pipe(Effect.result))._tag,
        ).toBe("Failure")
        const restarted = SessionProcessStore.make(database.db)
        expect((yield* restarted.output(session.id, first.record.id)).status).toBe("interrupted")
        expect((yield* restarted.output(session.id, first.record.id)).blockedReason).toBe("process_restart")
        const restart = yield* restarted.begin(invocation).pipe(Effect.result)
        expect(restart._tag).toBe("Failure")
        if (restart._tag === "Failure") expect(restart.failure.code).toBe("restart")
        const finished = yield* processes.finish(session.id, first.record.id, {
          status: "completed",
          exitCode: 0,
          output: "final😀",
          truncated: false,
        })
        expect(finished.status).toBe("completed")
        yield* processes.snapshot(session.id, first.record.id, "late", true)
        expect((yield* processes.output(session.id, first.record.id)).output).toBe("final😀")
        expect(yield* processes.notice(session.id, first.record.id, "observed")).toBe(true)
        expect(yield* processes.notice(session.id, first.record.id, "pending")).toBe(false)
        expect((yield* restarted.begin(invocation)).record.status).toBe("completed")
        expect(
          (yield* processes.finish(session.id, first.record.id, {
            status: "cancelled",
            output: "late cancel",
            truncated: true,
          })).status,
        ).toBe("completed")
        const view = yield* processes.output(session.id, first.record.id)
        expect(Object.keys(view).sort()).toEqual(
          [
            "background",
            "completedAt",
            "description",
            "exitCode",
            "id",
            "kind",
            "output",
            "sessionID",
            "startedAt",
            "status",
            "truncated",
          ].sort(),
        )
        const second = yield* processes.begin({
          ...invocation,
          callID: "call-two",
          request: { ...request, waitMs: 30 },
        })
        expect(second.record.background).toBe(false)
        expect((yield* processes.promote(session.id, second.record.id)).background).toBe(true)
        yield* processes.finish(session.id, second.record.id, {
          status: "cancelled",
          output: "cancel",
          truncated: false,
        })
        expect(yield* processes.notice(session.id, second.record.id, "pending")).toBe(false)
        expect((yield* processes.list(session.id)).map((item) => item.id)).toEqual([second.record.id, first.record.id])
        yield* database.db
          .update(SessionProcessTable)
          .set({ data: { ...finished, sessionCreated: "stale" } })
          .where(eq(SessionProcessTable.id, first.record.id))
        const stale = yield* processes.owned(session.id, first.record.id).pipe(Effect.result)
        expect(stale._tag).toBe("Failure")
        if (stale._tag === "Failure") expect(stale.failure.code).toBe("stale")
        yield* sessions.remove(session.id)
        expect(yield* processes.read(first.record.id)).toBeUndefined()
        const replacement = yield* sessions.create({ id: session.id, location: session.location })
        expect(yield* processes.list(replacement.id)).toEqual([])
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([SessionV2.node, Database.node, SessionProcessStore.node]), [
            [SessionExecution.node, SessionExecution.noopLayer],
            [Global.node, Global.layerWith({ home })],
            [
              ModelsDev.node,
              Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
            ],
          ]).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
          ),
        ),
      )
    }),
)
