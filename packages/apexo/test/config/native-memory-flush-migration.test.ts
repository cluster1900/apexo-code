import { expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Config } from "@apexo/core/config"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { Global } from "@apexo/core/global"
import { Location } from "@apexo/core/location"
import { AbsolutePath } from "@apexo/core/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(CrossSpawnSpawner.node))
it.live("real V1 document migrates custom legacy flush model and output limit", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const directory = yield* tmpdirScoped()
    const flush = {
      flush_model: "fixture/custom-memory",
      max_flush_write_chars: 317,
      enabled: false,
      idle_timeout_secs: 0,
      soft_threshold_tokens: 1234,
    }
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, "apexo.json"),
        JSON.stringify({ provider: {}, compaction: { memory_flush: flush } }),
      ),
    )
    return yield* Effect.gen(function* () {
      const config = yield* Config.Service
      const entries = yield* config.entries()
      const selected = entries
        .filter((entry) => entry.type === "document")
        .findLast((entry) => entry.path === path.join(directory, "apexo.json"))
      expect(selected).toBeDefined()
      expect(selected?.info.compaction?.memory_flush).toEqual(flush)
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
