import { expect } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { BackgroundJob } from "@apexo/core/background-job"
import { AgentV2 } from "@apexo/core/agent"
import { Global } from "@apexo/core/global"
import { ModelsDev } from "@apexo/core/models-dev"
import { AbsolutePath } from "@apexo/schema/schema"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionGoal } from "@apexo/core/session/goal"
import { SessionProcessStore } from "@apexo/core/session/process-store"
import { SessionProcessControl } from "@apexo/core/session/process-control"
import { SessionProcessCompletion } from "@apexo/core/session/process-completion"
import { SessionProcessExecution } from "@apexo/core/session/process-execution"
import { SessionMessage } from "@apexo/core/session/message"
import { SessionRunner } from "@apexo/core/session/runner"
import { ShellEnvironment } from "@apexo/core/shell-environment"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live(
  "owned shell processes resolve plugin shell.env at spawn time without persisting it",
  () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const directory = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false })))
      return yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const processes = yield* SessionProcessStore.Service
        const completions = yield* SessionProcessCompletion.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const execution = yield* SessionProcessExecution.Service
          const shell = yield* ShellEnvironment.Service
          const seen: ShellEnvironment.Event[] = []
          const run = (callID: string) =>
            Effect.gen(function* () {
              return yield* execution.execute({
                sessionID: parent.id,
                messageID: SessionMessage.ID.create(),
                callID,
                checkpoint: yield* completions.checkpoint(parent.id),
                request: {
                  agent: AgentV2.ID.make("build"),
                  command: 'printf "[%s]" "$APEXO_PLUGIN_SECRET"',
                  cwd: directory,
                  shell: "/bin/sh",
                  description: "Owned env shell",
                  waitMs: 2000,
                  timeoutMs: 10000,
                },
              })
            })
          const registration = yield* shell.hook.env((event) =>
            Effect.sync(() => {
              seen.push(event)
              event.env.APEXO_PLUGIN_SECRET = "s3cret"
            }),
          )
          const injected = yield* run("with-env")
          expect(injected.output).toBe("[s3cret]")
          expect(seen.map((event) => [event.sessionID, event.callID, event.cwd])).toEqual([
            [parent.id, "with-env", directory],
          ])
          // The resolved environment never lands in the durable process request.
          const stored = yield* processes.read(injected.id)
          expect(stored?.request).toBeDefined()
          expect(JSON.stringify(stored?.request)).not.toContain("s3cret")
          expect(JSON.stringify(stored?.request)).not.toContain("APEXO_PLUGIN_SECRET=")
          yield* registration.dispose
          const cleared = yield* run("without-env")
          expect(cleared.output).toBe("[]")
          expect(seen).toHaveLength(1)
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(parent.location)),
          Effect.provideService(SessionRunner.CurrentChildren, {
            run: () => Effect.void,
            interrupt: () => Effect.void,
            notify: () => Effect.void,
          }),
        )
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
