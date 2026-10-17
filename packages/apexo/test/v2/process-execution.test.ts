import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Fiber, Layer, Schedule } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Goal } from "@apexo/schema/goal"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionGoalUsage } from "@apexo/core/session/goal-usage"
import { BackgroundJob } from "@apexo/core/background-job"
import { AgentV2 } from "@apexo/core/agent"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionProcessStore } from "@apexo/core/session/process-store"
import { SessionProcessControl } from "@apexo/core/session/process-control"
import { SessionProcessCompletion } from "@apexo/core/session/process-completion"
import { SessionProcessExecution } from "@apexo/core/session/process-execution"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionRunner } from "@apexo/core/session/runner"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live(
  "real shell owner returns live preview, settles before notice, consumes once and joins cancellation",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false })))
      return yield* Effect.gen(function* () {
        const goals = yield* SessionGoal.Service
        const jobs = yield* BackgroundJob.Service
        const sessions = yield* SessionV2.Service
        const processes = yield* SessionProcessStore.Service
        const control = yield* SessionProcessControl.Service
        const completions = yield* SessionProcessCompletion.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const notifications: string[] = []
        const fileText = (name: string) =>
          Effect.gen(function* () {
            const text = (yield* Effect.tryPromise(() => Bun.file(path.join(directory, name)).text())).trim()
            if (!text) return yield* Effect.fail("empty")
            return text
          }).pipe(
            Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
            Effect.timeout("5 seconds"),
          )
        const closing = yield* Effect.gen(function* () {
          const execution = yield* SessionProcessExecution.Service
          const checkpoint = yield* completions.checkpoint(parent.id)
          const input = {
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "live",
            checkpoint,
            request: {
              agent: AgentV2.ID.make("build"),
              command: "echo $$ > pid; printf 'LIVE😀'; while [ ! -f release ]; do sleep 0.02; done; printf DONE",
              cwd: directory,
              shell: "/bin/sh",
              description: "Owned live shell",
              waitMs: 0,
              timeoutMs: 10000,
            },
          }
          const running = yield* execution.execute(input)
          expect(running.status).toBe("running")
          expect(running.background).toBe(true)
          expect((yield* processes.owned(parent.id, running.id)).spawned).toBe(true)
          const poll = Effect.gen(function* () {
            const value = yield* control.output(parent.id, running.id)
            if (!value.output.includes("LIVE😀")) return yield* Effect.fail("pending")
            return value
          }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }))
          // The process observer publishes its first nonempty chunk before command completion.
          const preview = yield* poll.pipe(Effect.timeout("5 seconds"))
          expect(preview.status).toBe("running")
          expect((yield* control.wait(parent.id, running.id, 0)).timedOut).toBe(true)
          expect(notifications).toEqual([])
          expect((yield* execution.execute(input)).id).toBe(running.id)
          const pid = Number(yield* fileText("pid"))
          process.kill(pid, 0)
          yield* Effect.promise(() => Bun.write(path.join(directory, "release"), "ready"))
          const settled = yield* control.wait(parent.id, running.id, 5000)
          expect(settled.timedOut).toBe(false)
          expect(settled.process.status).toBe("completed")
          expect(settled.process.output).toBe("LIVE😀DONE")
          yield* Effect.gen(function* () {
            if (notifications.length === 0) return yield* Effect.fail("pending")
          }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }), Effect.timeout("5 seconds"))
          expect(notifications).toEqual(["completed"])
          expect(yield* completions.pending(parent.id)).toBe(true)
          const foreign = yield* sessions.create({ location: parent.location })
          expect((yield* completions.observed(foreign.id, running.id).pipe(Effect.result))._tag).toBe("Failure")
          expect(yield* completions.pending(parent.id)).toBe(true)
          expect(yield* completions.take(parent.id)).toContain(running.id)
          expect(yield* completions.take(parent.id)).toBe("")
          expect(() => process.kill(pid, 0)).toThrow()
          const cancel = yield* execution.execute({
            ...input,
            callID: "cancel",
            request: { ...input.request, command: "echo $$ > cancelled-pid; while true; do sleep 1; done" },
          })
          const cancelled = yield* control.cancel(parent.id, cancel.id)
          expect(cancelled.status).toBe("cancelled")
          expect((yield* processes.owned(parent.id, cancel.id)).notice).toBe("suppressed")
          expect(notifications).toEqual(["completed"])
          const failed = yield* execution
            .execute({ ...input, callID: "spawn-fail", request: { ...input.request, shell: "/apexo-missing-shell" } })
            .pipe(Effect.result)
          expect(failed._tag).toBe("Failure")
          const failedReceipt = (yield* control.list(parent.id))[0]
          yield* jobs.wait({ id: failedReceipt.id })
          expect(notifications).toEqual(["completed"])
          expect(
            (yield* control.list(parent.id)).find((item) => item.id !== cancel.id && item.id !== running.id)?.status,
          ).toBe("failed")
          const promotion = yield* execution
            .execute({
              ...input,
              callID: "timed",
              request: {
                ...input.request,
                command:
                  "echo $$ > timed-pid; printf TIMED; while [ ! -f timed-release ]; do sleep 0.02; done; printf END",
                waitMs: 250,
              },
            })
            .pipe(Effect.forkScoped)
          const beforePromotionPid = Number(yield* fileText("timed-pid"))
          process.kill(beforePromotionPid, 0)
          const timed = yield* Fiber.join(promotion)
          expect(timed.status).toBe("running")
          expect(timed.background).toBe(true)
          const timedPid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "timed-pid")).text()))
          process.kill(timedPid, 0)
          expect(timedPid).toBe(beforePromotionPid)
          completions.stop(checkpoint.claim)
          yield* Effect.promise(() => Bun.write(path.join(directory, "timed-release"), "ready"))
          const timedResult = yield* control.wait(parent.id, timed.id, 5000)
          yield* jobs.wait({ id: timed.id })
          expect(timedResult.process.output).toBe("TIMEDEND")
          expect(notifications).toEqual(["completed"])
          expect(yield* completions.pending(parent.id)).toBe(false)
          expect(() => process.kill(timedPid, 0)).toThrow()
          const waited = yield* execution.execute({
            ...input,
            callID: "waited",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: { ...input.request, command: "printf WAITED", waitMs: 1000 },
          })
          yield* jobs.wait({ id: waited.id })
          expect(waited.status).toBe("completed")
          expect(waited.background).toBe(false)
          expect(waited.output).toBe("WAITED")
          expect(notifications).toEqual(["completed"])
          const goal = yield* goals.create(parent.id, {
            id: Goal.ID.create(),
            objective: "Captured attempt must retain accounting authority",
          })
          const target = { sessionID: parent.id, goalID: goal.id }
          const attempt = yield* goals.begin(target, "executing")
          yield* goals.pause(target, "user_paused")
          const beforeGoal = yield* control.list(parent.id)
          const denied = yield* execution
            .execute({
              ...input,
              callID: "paused-goal-attempt",
              checkpoint: yield* completions.checkpoint(parent.id),
              request: { ...input.request, command: "printf ESCAPED > goal-escape", waitMs: 1000 },
            })
            .pipe(Effect.provideService(SessionGoalUsage.Current, attempt), Effect.result)
          expect(denied._tag).toBe("Failure")
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "goal-escape")).exists())).toBe(false)
          expect(yield* control.list(parent.id)).toEqual(beforeGoal)
          const ordinary = yield* execution.execute({
            ...input,
            callID: "paused-ordinary",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: { ...input.request, command: "printf ORDINARY", waitMs: 1000 },
          })
          expect(ordinary.output).toBe("ORDINARY")
          const deleting = yield* execution.execute({
            ...input,
            callID: "delete",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: { ...input.request, command: "echo $$ > deleting-pid; while true; do sleep 1; done" },
          })
          const deletingPid = Number(yield* fileText("deleting-pid"))
          yield* sessions.remove(parent.id)
          expect(() => process.kill(deletingPid, 0)).toThrow()
          expect(yield* processes.read(deleting.id)).toBeUndefined()
          expect(notifications).toEqual(["completed"])
          const other = yield* sessions.create({ location: parent.location })
          const retiring = yield* execution.execute({
            ...input,
            sessionID: other.id,
            callID: "location-close",
            checkpoint: yield* completions.checkpoint(other.id),
            request: { ...input.request, command: "echo $$ > retiring-pid; while true; do sleep 1; done" },
          })
          return { sessionID: other.id, id: retiring.id, pid: Number(yield* fileText("retiring-pid")) }
        }).pipe(
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, {
            run: () => Effect.void,
            interrupt: () => Effect.void,
            notify: () =>
              Effect.gen(function* () {
                const latest = (yield* control.list(parent.id))[0]
                notifications.push(latest.status)
              }).pipe(Effect.orDie),
          }),
        )
        yield* locations.invalidate(parent.location)
        expect(() => process.kill(closing.pid, 0)).toThrow()
        expect((yield* control.output(closing.sessionID, closing.id)).status).toBe("cancelled")
        expect(notifications).toEqual(["completed"])
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              BackgroundJob.node,
              SessionGoal.node,
              SessionProcessStore.node,
              SessionProcessControl.node,
              SessionProcessCompletion.node,
              LocationServiceMap.node,
            ]),
            [
              [SessionExecution.node, SessionExecution.noopLayer],
              [Global.node, Global.layerWith({ home })],
              [
                ModelsDev.node,
                Layer.succeed(ModelsDev.Service, { get: () => Effect.succeed({}), refresh: () => Effect.void }),
              ],
            ],
          ).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ APEXO_RUNTIME_PROFILE: "grok-build" }))),
          ),
        ),
      )
    }),
  30000,
)
