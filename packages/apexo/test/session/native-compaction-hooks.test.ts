import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { PluginStore } from "@apexo/core/plugin-store"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { AbsolutePath } from "@apexo/schema/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), TestLLMServer.layer))
const setup = (auto = false) =>
  Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const llm = yield* TestLLMServer
    const mode = path.join(root, "mode")
    const trace = path.join(root, "trace.jsonl")
    const source = path.join(root, "catalog")
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "data"), { recursive: true })
      await Bun.write(mode, "ready")
      await Bun.write(
        path.join(root, "observer.py"),
        `import json,os,sys,time
value=json.load(sys.stdin)
mode=open(sys.argv[2]).read()
with open(sys.argv[1], 'a') as out: out.write(json.dumps({"event":value["hook_event_name"],"source":value["source"],"session":value["session_id"],"pid":os.getpid(),"label":sys.argv[3]})+'\\n')
if mode == 'hang-pre' and value['hook_event_name']=='PreCompact' or mode == 'hang-post' and value['hook_event_name']=='PostCompact':
 while open(sys.argv[2]).read()==mode: time.sleep(.01)
if mode=='deny':
 print(json.dumps({"decision":"block","reason":"must not veto", "continue":False,"hookSpecificOutput":{"additionalContext":"MUST_NOT_ENTER_MODEL"}}))
 sys.exit(2)
`,
      )
      await Bun.write(
        path.join(source, ".grok-plugin/marketplace.json"),
        JSON.stringify({ name: "Hooks", plugins: [{ name: "compact", source: "./compact" }] }),
      )
      await Bun.write(path.join(source, "compact/plugin.json"), JSON.stringify({ name: "compact" }))
      const command = `python3 '${path.join(root, "observer.py")}' '${trace}' '${mode}' included`
      const skipped = `python3 '${path.join(root, "observer.py")}' '${trace}' '${mode}' wrong-matcher`
      await Bun.write(
        path.join(source, "compact/hooks/hooks.json"),
        JSON.stringify({
          hooks: Object.fromEntries(
            ["PreCompact", "PostCompact"].map((event) => [
              event,
              [
                { matcher: "manual|auto", hooks: [{ type: "command", command, timeout: 5 }] },
                { matcher: "never", hooks: [{ type: "command", command: skipped }] },
              ],
            ]),
          ),
        }),
      )
      await Bun.write(
        path.join(root, "apexo.json"),
        JSON.stringify({
          snapshots: false,
          compaction: { auto, buffer: 80000, keep: { tokens: 0 } },
          providers: {
            test: {
              name: "Hook compaction provider",
              api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url, settings: { apiKey: "test" } },
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
    const catalog = yield* Effect.promise(() =>
      PluginStore.mutate(path.join(root, "data/plugins"), { action: "add-source", source }),
    )
    yield* Effect.promise(() =>
      PluginStore.mutate(path.join(root, "data/plugins"), { action: "install", id: catalog.items[0]!.id, trust: true }),
    )
    return {
      root,
      mode,
      trace,
      llm,
      read: Effect.promise(async () =>
        (
          await Bun.file(trace)
            .text()
            .catch(() => "")
        )
          .split("\n")
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as { event: string; source: string; session: string; pid: number; label: string },
          ),
      ),
      location: { directory: AbsolutePath.make(root) },
      model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("fixture") },
      app: AppNodeBuilder.build(
        LayerNode.group([SessionV2.node, SessionExecutionLocal.node, SessionHookSnapshot.node]),
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
    }
  })

it.live(
  "native manual compaction observes only actual attempts, ignores veto output, and omits Post after provider failure",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const snapshots = yield* SessionHookSnapshot.Service
        const session = yield* sessions.create({ location: f.location, model: f.model })
        yield* sessions.compact({ sessionID: session.id })
        expect(yield* f.read).toEqual([])
        expect(yield* snapshots.get(session.id)).toBeUndefined()
        yield* f.llm.text("Preserve apricot")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Remember apricot" } })
        yield* sessions.wait(session.id)
        expect(yield* f.read).toEqual([])
        yield* Effect.promise(() => Bun.write(f.mode, "deny"))
        yield* f.llm.text("## Objective\nPreserve apricot")
        yield* sessions.compact({ sessionID: session.id })
        expect((yield* f.read).map((value) => [value.event, value.source, value.label])).toEqual([
          ["PreCompact", "manual", "included"],
          ["PostCompact", "manual", "included"],
        ])
        expect((yield* f.read).every((value) => value.session === session.id)).toBe(true)
        expect(yield* f.llm.calls).toBe(2)
        expect(JSON.stringify(yield* f.llm.inputs)).not.toContain("MUST_NOT_ENTER_MODEL")
        const before = yield* sessions.messages({ sessionID: session.id })
        expect(before.some((message) => message.type === "compaction")).toBe(true)
        yield* f.llm.error(400, { error: { message: "Summary rejected" } })
        expect(Exit.isFailure(yield* sessions.compact({ sessionID: session.id }).pipe(Effect.exit))).toBe(true)
        expect((yield* f.read).map((value) => value.event)).toEqual(["PreCompact", "PostCompact", "PreCompact"])
        expect(yield* sessions.messages({ sessionID: session.id })).toEqual(before)
        expect(yield* f.llm.calls).toBe(3)
      }).pipe(Effect.provide(f.app))
    }),
)

it.live("native automatic compaction reports auto before continuing the same admitted turn", () =>
  Effect.gen(function* () {
    const f = yield* setup(true)
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({ location: f.location, model: f.model })
      yield* f.llm.text("## Objective\nA compact summary")
      yield* f.llm.text("Completed")
      yield* sessions.prompt({ sessionID: session.id, prompt: { text: "automatic context ".repeat(12000) } })
      yield* sessions.wait(session.id)
      expect((yield* f.read).map((value) => [value.event, value.source])).toEqual([
        ["PreCompact", "auto"],
        ["PostCompact", "auto"],
      ])
      expect(yield* f.llm.calls).toBe(2)
      expect(
        (yield* sessions.messages({ sessionID: session.id })).filter((message) => message.type === "user"),
      ).toHaveLength(1)
    }).pipe(Effect.provide(f.app))
  }),
)

it.live(
  "native deletion joins a held PreCompact observer and cancellation after Ended preserves committed compaction",
  () =>
    Effect.gen(function* () {
      const f = yield* setup()
      yield* Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const session = yield* sessions.create({ location: f.location, model: f.model })
        yield* f.llm.text("Seed")
        yield* sessions.prompt({ sessionID: session.id, prompt: { text: "Seed" } })
        yield* sessions.wait(session.id)
        yield* Effect.promise(() => Bun.write(f.mode, "hang-post"))
        yield* f.llm.text("## Objective\nCommitted before observer cancellation")
        const compact = yield* sessions.compact({ sessionID: session.id }).pipe(Effect.exit, Effect.forkChild)
        const post = yield* pollWithTimeout(
          f.read.pipe(Effect.map((rows) => rows.find((row) => row.event === "PostCompact"))),
          "post observer started",
          "10 seconds",
        )
        expect(
          (yield* sessions.messages({ sessionID: session.id })).some((message) => message.type === "compaction"),
        ).toBe(true)
        yield* sessions.interrupt(session.id)
        yield* Fiber.join(compact)
        expect(() => process.kill(post.pid, 0)).toThrow()
        expect(yield* f.llm.calls).toBe(2)
        expect(
          (yield* sessions.messages({ sessionID: session.id })).some((message) => message.type === "compaction"),
        ).toBe(true)
        yield* Effect.promise(() => Bun.write(f.mode, "hang-pre"))
        const stopped = yield* sessions.compact({ sessionID: session.id }).pipe(Effect.exit, Effect.forkChild)
        const pre = yield* pollWithTimeout(
          f.read.pipe(Effect.map((rows) => (rows.length === 3 ? rows[2] : undefined))),
          "pre observer started",
          "10 seconds",
        )
        yield* sessions.remove(session.id).pipe(Effect.timeout("10 seconds"))
        yield* Fiber.join(stopped)
        expect(() => process.kill(pre.pid, 0)).toThrow()
        expect(yield* f.llm.calls).toBe(2)
        expect((yield* f.read).map((value) => value.event)).toEqual(["PreCompact", "PostCompact", "PreCompact"])
        yield* sessions.create({ id: session.id, location: f.location, model: f.model })
        expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      }).pipe(Effect.provide(f.app))
    }),
)
