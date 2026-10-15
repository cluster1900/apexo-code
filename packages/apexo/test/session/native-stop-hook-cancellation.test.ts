import { expect } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Database } from "@apexo/core/database/database"
import { Global } from "@apexo/core/global"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionHookStop } from "@apexo/core/session/hook-stop"
import { SessionHookStopTable } from "@apexo/core/session/hook-stop.sql"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))

for (const action of ["stop", "delete"] as const)
  it.live(`native Session ${action} joins a normal Stop hook that ignores TERM`, () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      const llm = yield* TestLLMServer
      const home = path.join(root, "home")
      const pidfile = path.join(root, "hook.pid")
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = { home: process.env.GROK_HOME, profile: process.env.APEXO_RUNTIME_PROFILE }
          process.env.GROK_HOME = home
          process.env.APEXO_RUNTIME_PROFILE = "grok-build"
          return previous
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous.home === undefined) delete process.env.GROK_HOME
            else process.env.GROK_HOME = previous.home
            if (previous.profile === undefined) delete process.env.APEXO_RUNTIME_PROFILE
            else process.env.APEXO_RUNTIME_PROFILE = previous.profile
          }),
      )
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(root, "data"), { recursive: true })
        const script = path.join(root, "held-hook.mjs")
        await Bun.write(
          script,
          `process.on("SIGTERM", () => {}); await Bun.write(${JSON.stringify(pidfile)}, String(process.pid)); setInterval(() => {}, 1000);`,
        )
        await Bun.write(
          path.join(home, "hooks/stop.json"),
          JSON.stringify({
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: `exec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}'`,
                    },
                  ],
                },
              ],
            },
          }),
        )
        await Bun.write(
          path.join(root, "apexo.json"),
          JSON.stringify({
            snapshots: false,
            providers: {
              test: {
                name: "Stop hook provider",
                api: {
                  type: "aisdk",
                  package: "@ai-sdk/openai-compatible",
                  url: llm.url,
                  settings: { apiKey: "test" },
                },
                models: {
                  fixture: {
                    name: "Fixture",
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 4096 },
                  },
                },
              },
            },
          }),
        )
      })
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const snapshots = yield* SessionHookSnapshot.Service
        const database = yield* Database.Service
        const location = { directory: AbsolutePath.make(root) }
        const model = { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") }
        const session = yield* sessions.create({ location, model })
        yield* llm.text("A normally completed answer")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Finish once" }, resume: false })
        const running = yield* sessions.resume(session.id).pipe(Effect.forkChild)
        const pid = yield* pollWithTimeout(
          Effect.promise(async () =>
            (await Bun.file(pidfile).exists()) ? Number(await Bun.file(pidfile).text()) : undefined,
          ),
          "normal Stop hook owns a real process",
          "10 seconds",
        )
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            try {
              process.kill(pid, "SIGKILL")
            } catch {}
            await Bun.sleep(250)
          }),
        )
        const hook = yield* snapshots.get(session.id)
        if (action === "stop") yield* sessions.interrupt(session.id)
        if (action === "delete") yield* sessions.remove(session.id)
        yield* Fiber.await(running)
        expect(() => process.kill(pid, 0)).toThrow()
        expect(yield* llm.calls).toBe(1)
        const receipt = yield* database.db.select().from(SessionHookStopTable).get()
        if (action === "stop") {
          expect(receipt?.state).toBe("evaluating")
          expect(receipt?.session_id).toBe(session.id)
          expect(
            yield* SessionHookStop.evaluate(database.db, {
              sessionID: session.id,
              messageID: receipt!.message_id,
              engine: "v2",
              directory: root,
              enabled: true,
              continuations: 0,
              registry: hook?.registry,
              selection: hook?.selection,
            }),
          ).toEqual({ continue: false, forceStop: false })
          expect(yield* SessionHookStop.pending(database.db, session.id)).toBeUndefined()
        }
        if (action === "delete") {
          expect(receipt).toBeUndefined()
          yield* sessions.create({ id: session.id, location, model })
          expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
        }
        expect(yield* llm.calls).toBe(1)
        expect(yield* Effect.promise(() => Bun.file(pidfile).text())).toBe(String(pid))
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([SessionV2.node, SessionExecutionLocal.node, SessionHookSnapshot.node, Database.node]),
            [
              [SessionExecution.node, SessionExecutionLocal.node],
              [
                Global.node,
                Layer.succeed(Global.Service)(
                  Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
                ),
              ],
            ],
          ),
        ),
      )
    }),
  )
