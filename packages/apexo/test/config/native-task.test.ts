import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Config } from "@apexo/core/config"
import { ConfigTask } from "@apexo/core/config/task"
import { ConfigV1 } from "@apexo/core/v1/config/config"
import { ConfigMigrateV1 } from "@apexo/core/v1/config/migrate"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { AbsolutePath } from "@apexo/core/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

test("Task depth validates native/V1 configuration and preserves the private invalid marker", () => {
  expect(ConfigTask.maxDepth([])).toBe(1)
  for (const maxDepth of [1, 2, 16]) {
    expect(Schema.decodeUnknownSync(Config.Info)({ task: { maxDepth } }).task).toEqual({ maxDepth })
    expect(
      ConfigMigrateV1.migrate(Schema.decodeUnknownSync(ConfigV1.Info)({ provider: {}, task: { maxDepth } })).task,
    ).toEqual({ maxDepth })
  }
  for (const maxDepth of [0, 17, 1.5, "2", null])
    expect(() => Schema.decodeUnknownSync(ConfigTask.Info)({ maxDepth })).toThrow()
  const document = new Config.Document({ type: "document", info: new Config.Info({}), taskInvalid: true })
  const decoded = Schema.decodeUnknownSync(Config.Document)(Schema.encodeSync(Config.Document)(document))
  expect(ConfigTask.maxDepth([decoded])).toBeUndefined()
  expect(Object.keys(decoded.info)).not.toContain("taskInvalid")
})

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
for (const legacy of [false, true]) {
  for (const scenario of ["higher-invalid", "higher-valid", "other-invalid"] as const) {
    it.live(`Task real ${legacy ? "V1" : "V2"} document precedence: ${scenario}`, () =>
      Effect.gen(function* () {
        const home = yield* tmpdirScoped()
        const directory = yield* tmpdirScoped()
        const dialect = legacy ? { provider: {} } : {}
        yield* Effect.promise(() =>
          Bun.write(
            path.join(home, "apexo.json"),
            JSON.stringify({ ...dialect, task: { maxDepth: scenario === "higher-valid" ? 99 : 8 } }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(directory, "apexo.json"),
            JSON.stringify({
              ...dialect,
              task: { maxDepth: scenario === "higher-valid" ? 2 : 99 },
              ...(scenario === "other-invalid"
                ? legacy
                  ? { username: 42, permission: "allow" }
                  : { username: 42, permissions: [{ action: "*", resource: "*", effect: "allow" }] }
                : {}),
            }),
          ),
        )
        return yield* Effect.gen(function* () {
          const config = yield* Config.Service
          const entries = yield* config.entries()
          expect(ConfigTask.maxDepth(entries)).toBe(scenario === "higher-valid" ? 2 : undefined)
          const selected = entries
            .filter((entry) => entry.type === "document")
            .findLast((entry) => entry.path === path.join(directory, "apexo.json"))
          expect(selected).toBeDefined()
          if (scenario !== "higher-valid") {
            expect(selected?.taskInvalid).toBe(true)
            expect(selected?.info.permissions).toBeUndefined()
            expect(selected?.info.providers).toBeUndefined()
          }
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(Config.node, [
              [Global.node, Global.layerWith({ home, config: home })],
              [Location.node, Location.boundNode({ directory: AbsolutePath.make(directory) })],
            ]),
          ),
        )
      }),
    )
  }
}

test("active Task delivery is opt-in and invalid explicit Task config fails closed", () => {
  expect(ConfigTask.activeMessages([])).toBe(false)
  const enabled = new Config.Document({ type: "document", info: new Config.Info({ task: { activeMessages: true } }) })
  expect(ConfigTask.activeMessages([enabled])).toBe(true)
  expect(
    ConfigTask.activeMessages([
      enabled,
      new Config.Document({ type: "document", info: new Config.Info({ task: { activeMessages: false } }) }),
    ]),
  ).toBe(false)
  expect(
    ConfigTask.activeMessages([
      enabled,
      new Config.Document({ type: "document", info: new Config.Info({}), taskInvalid: true }),
    ]),
  ).toBe(false)
  expect(
    ConfigMigrateV1.migrate(Schema.decodeUnknownSync(ConfigV1.Info)({ provider: {}, task: { activeMessages: true } }))
      .task,
  ).toEqual({ activeMessages: true })
  expect(() => Schema.decodeUnknownSync(ConfigTask.Info)({ activeMessages: "true" })).toThrow()
})
