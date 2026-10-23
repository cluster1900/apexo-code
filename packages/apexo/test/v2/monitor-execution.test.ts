import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer, Schedule } from "effect"
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
  "real unconfined Monitor preserves split UTF-8 pipes, Stop epochs, terminal ordering and owner deletion",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false })))
      return yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const jobs = yield* BackgroundJob.Service
        const processes = yield* SessionProcessStore.Service
        const control = yield* SessionProcessControl.Service
        const completions = yield* SessionProcessCompletion.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const notifications: string[] = []
        yield* Effect.gen(function* () {
          const execution = yield* SessionProcessExecution.Service
          const checkpoint = yield* completions.checkpoint(parent.id)
          const run = yield* execution.execute({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "monitor",
            checkpoint,
            request: {
              agent: AgentV2.ID.make("build"),
              shell: "/bin/sh",
              cwd: directory,
              waitMs: 0,
              timeoutMs: 10000,
              description: "Observe both streams",
              monitor: { persistent: true },
              command:
                "echo $$ > pid; printf 'FIRST\\360\\237'; sleep 0.01; printf 'ERROR中文\n' >&2; sleep 0.01; printf '\\230\\200\n'; while [ ! -f paused ]; do sleep 0.02; done; printf 'PAUSED\n'; while [ ! -f resumed ]; do sleep 0.02; done; printf 'FUTURE\n'; while [ ! -f done ]; do sleep 0.02; done; printf 'TAIL'",
            },
          })
          const awaitOutput = (text: string) =>
            Effect.gen(function* () {
              const value = yield* control.output(parent.id, run.id)
              if (!value.output.includes(text)) return yield* Effect.fail("pending output")
              return value
            }).pipe(Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }), Effect.timeout("5 seconds"))
          const awaitPending = Effect.gen(function* () {
            if (!(yield* completions.pending(parent.id))) return yield* Effect.fail("pending event")
          }).pipe(Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }), Effect.timeout("5 seconds"))
          expect(run.kind).toBe("monitor")
          expect(run.monitor?.persistent).toBe(true)
          yield* awaitOutput("😀")
          yield* awaitOutput("ERROR中文")
          yield* awaitPending
          const foreign = yield* sessions.create({ location: parent.location })
          expect(yield* completions.pending(foreign.id)).toBe(false)
          expect(yield* completions.takeEvents(foreign.id)).toBe("")
          const first = yield* completions.takeEvents(parent.id)
          expect(first).toContain("FIRST😀")
          expect(first).toContain("ERROR中文")
          expect(first).not.toContain("�")
          expect(yield* completions.takeEvents(parent.id)).toBe("")
          expect(yield* completions.take(parent.id)).toBe("")
          expect(notifications).toEqual(["running"])
          completions.stop(checkpoint.claim)
          yield* Effect.promise(() => Bun.write(path.join(directory, "paused"), "yes"))
          yield* awaitOutput("PAUSED")
          yield* Effect.sleep("250 millis")
          expect(yield* completions.pending(parent.id)).toBe(false)
          expect(yield* completions.takeEvents(parent.id)).toBe("")
          expect(notifications).toEqual(["running"])
          yield* completions.rearm(parent.id)
          expect(yield* completions.takeEvents(parent.id)).toBe("")
          yield* Effect.promise(() => Bun.write(path.join(directory, "resumed"), "yes"))
          yield* awaitPending
          const future = yield* completions.takeEvents(parent.id)
          expect(future).toContain("FUTURE")
          expect(future).not.toContain("PAUSED")
          yield* Effect.promise(() => Bun.write(path.join(directory, "done"), "yes"))
          const final = yield* control.wait(parent.id, run.id, 5000)
          yield* jobs.wait({ id: run.id })
          expect(final.process.status).toBe("completed")
          expect(final.process.output).toContain("PAUSED")
          expect(final.process.monitor?.accepted).toBeGreaterThanOrEqual(3)
          const completion = yield* completions.take(parent.id)
          expect(completion).toContain("TAIL")
          expect(yield* completions.takeEvents(parent.id)).toBe("")
          expect(yield* completions.take(parent.id)).toBe("")
          expect(notifications).toEqual(["running", "running", "completed"])
          const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "pid")).text()))
          expect(() => process.kill(pid, 0)).toThrow()
          const saturated = yield* execution.execute({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "saturated",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: {
              agent: AgentV2.ID.make("build"),
              shell: "/bin/sh",
              cwd: directory,
              waitMs: 0,
              timeoutMs: 10000,
              description: "Bounded retained output",
              monitor: { persistent: false },
              command:
                "head -c 1100000 /dev/zero | tr '\\0' x; printf '\\n'; while [ ! -f large-release ]; do sleep 0.02; done; printf 'AFTER_CAPTURE_LIMIT\\n'; while true; do sleep 1; done",
            },
          })
          yield* awaitPending
          expect(yield* completions.takeEvents(parent.id)).toContain("line truncated")
          expect((yield* control.output(parent.id, saturated.id)).truncated).toBe(true)
          yield* Effect.promise(() => Bun.write(path.join(directory, "large-release"), "go"))
          yield* awaitPending
          expect(yield* completions.takeEvents(parent.id)).toContain("AFTER_CAPTURE_LIMIT")
          expect((yield* control.output(parent.id, saturated.id)).output).not.toContain("AFTER_CAPTURE_LIMIT")
          yield* control.cancel(parent.id, saturated.id)
          yield* completions.observed(parent.id, saturated.id)
          const goals = yield* SessionGoal.Service
          const goal = yield* goals.create(parent.id, {
            id: Goal.ID.create(),
            objective: "Monitor must not escape captured Goal accounting",
          })
          const target = { sessionID: parent.id, goalID: goal.id }
          const attempt = yield* goals.begin(target, "executing")
          yield* goals.pause(target, "user_paused")
          const beforeGoal = yield* control.list(parent.id)
          const denied = yield* execution
            .execute({
              sessionID: parent.id,
              messageID: SessionMessage.ID.create(),
              callID: "goal-denied",
              checkpoint: yield* completions.checkpoint(parent.id),
              request: {
                agent: AgentV2.ID.make("build"),
                shell: "/bin/sh",
                cwd: directory,
                waitMs: 0,
                timeoutMs: 1000,
                description: "Denied",
                monitor: { persistent: false },
                command: "printf ESCAPE > goal-escape",
              },
            })
            .pipe(Effect.provideService(SessionGoalUsage.Current, attempt), Effect.result)
          expect(denied._tag).toBe("Failure")
          expect(yield* control.list(parent.id)).toEqual(beforeGoal)
          expect(yield* Effect.promise(() => Bun.file(path.join(directory, "goal-escape")).exists())).toBe(false)
          const deleted = yield* execution.execute({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "delete",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: {
              agent: AgentV2.ID.make("build"),
              shell: "/bin/sh",
              cwd: directory,
              waitMs: 0,
              timeoutMs: 0,
              description: "Delete monitor",
              monitor: { persistent: false },
              command: "echo $$ > deleting; while true; do sleep 1; done",
            },
          })
          const deletingPid = yield* Effect.tryPromise(async () => {
            const text = (await Bun.file(path.join(directory, "deleting")).text()).trim()
            const pid = Number(text)
            if (!Number.isInteger(pid) || pid <= 0) throw new Error("pending pid")
            return pid
          }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }))
          yield* sessions.remove(parent.id)
          yield* jobs.wait({ id: deleted.id })
          expect(() => process.kill(deletingPid, 0)).toThrow()
          expect(yield* processes.read(deleted.id)).toBeUndefined()
        }).pipe(
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, {
            run: () => Effect.void,
            interrupt: () => Effect.void,
            notify: () =>
              Effect.gen(function* () {
                notifications.push((yield* control.list(parent.id))[0].status)
              }).pipe(Effect.orDie),
          }),
        )
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              SessionGoal.node,
              BackgroundJob.node,
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

it.live(
  "sustained Monitor overload kills and joins the actual process before terminal notification",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false })))
      return yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const control = yield* SessionProcessControl.Service
        const completions = yield* SessionProcessCompletion.Service
        const jobs = yield* BackgroundJob.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const notices: string[] = []
        yield* Effect.gen(function* () {
          const execution = yield* SessionProcessExecution.Service
          const result = yield* execution.execute({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "overload",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: {
              agent: AgentV2.ID.make("build"),
              shell: "/bin/sh",
              cwd: directory,
              waitMs: 0,
              timeoutMs: 0,
              monitor: { persistent: true },
              description: "Noisy Monitor",
              command: "echo $$ > pid; while true; do printf 'NOISY\n'; sleep 0.02; done",
            },
          })
          const settled = yield* control.wait(parent.id, result.id, 45000)
          yield* jobs.wait({ id: result.id })
          expect(settled.timedOut).toBe(false)
          expect(settled.process.status).toBe("failed")
          expect(settled.process.monitor?.overloaded).toBe(true)
          expect(settled.process.monitor?.suppressed).toBeGreaterThan(0)
          const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "pid")).text()))
          expect(() => process.kill(pid, 0)).toThrow()
          expect(notices.at(-1)).toBe("failed")
          expect(yield* completions.take(parent.id)).toContain("sustained output overload")
        }).pipe(
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, {
            run: () => Effect.void,
            interrupt: () => Effect.void,
            notify: () =>
              Effect.gen(function* () {
                const status = (yield* control.list(parent.id))[0].status
                notices.push(status)
                if (status !== "running") {
                  const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "pid")).text()))
                  expect(() => process.kill(pid, 0)).toThrow()
                }
              }).pipe(Effect.orDie),
          }),
        )
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              BackgroundJob.node,
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
  55000,
)

it.live(
  "ordinary Shell publishes its trailing chunk while the same process is silently held",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false })))
      return yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const control = yield* SessionProcessControl.Service
        const completions = yield* SessionProcessCompletion.Service
        const jobs = yield* BackgroundJob.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const notices: string[] = []
        yield* Effect.gen(function* () {
          const execution = yield* SessionProcessExecution.Service
          const result = yield* execution.execute({
            sessionID: parent.id,
            messageID: SessionMessage.ID.create(),
            callID: "trailing",
            checkpoint: yield* completions.checkpoint(parent.id),
            request: {
              agent: AgentV2.ID.make("build"),
              shell: "/bin/sh",
              cwd: directory,
              waitMs: 0,
              timeoutMs: 10000,
              description: "Trailing Shell",
              command:
                "echo $$ > pid; printf FIRST; sleep 0.03; printf LAST; while [ ! -f release ]; do sleep 0.02; done",
            },
          })
          const snapshot = yield* Effect.gen(function* () {
            const snapshot = yield* control.output(parent.id, result.id)
            if (snapshot.output !== "FIRSTLAST") return yield* Effect.fail("trailing chunk not persisted")
            return snapshot
          }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }), Effect.timeout("3 seconds"))
          expect(snapshot.status).toBe("running")
          expect(notices).toEqual([])
          const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "pid")).text()))
          process.kill(pid, 0)
          yield* Effect.promise(() => Bun.write(path.join(directory, "release"), "go"))
          expect((yield* control.wait(parent.id, result.id, 5000)).process.output).toBe("FIRSTLAST")
          yield* jobs.wait({ id: result.id })
          expect(() => process.kill(pid, 0)).toThrow()
        }).pipe(
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, {
            run: () => Effect.void,
            interrupt: () => Effect.void,
            notify: () =>
              Effect.gen(function* () {
                const status = (yield* control.list(parent.id))[0].status
                notices.push(status)
                if (status !== "running") {
                  const pid = Number(yield* Effect.promise(() => Bun.file(path.join(directory, "pid")).text()))
                  expect(() => process.kill(pid, 0)).toThrow()
                }
              }).pipe(Effect.orDie),
          }),
        )
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([
              SessionV2.node,
              BackgroundJob.node,
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
  10000,
)
