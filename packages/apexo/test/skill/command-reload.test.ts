import { expect } from "bun:test"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Effect, Layer } from "effect"
import path from "path"
import { Command } from "@/command"
import { Skill } from "@/skill"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { TestInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Command.node, Skill.node, CrossSpawnSpawner.node])),
    testInstanceStoreLayer,
  ),
)

it.instance(
  "skill commands reflect content changes after Skill.reload",
  Effect.gen(function* () {
      const file = path.join((yield* TestInstance).directory, ".apexo", "skill", "reload-command", "SKILL.md")
      yield* Effect.promise(() => Bun.write(file, "---\nname: reload-command\n---\nbefore"))
      const commands = yield* Command.Service
      const skills = yield* Skill.Service
      expect((yield* commands.get("reload-command"))?.template).toContain("before")
      expect((yield* commands.list()).find((item) => item.name === "reload-command")?.template).toContain("before")
      yield* Effect.promise(() => Bun.write(file, "---\nname: reload-command\n---\nafter"))
      yield* skills.reload()
      expect((yield* commands.get("reload-command"))?.template).toContain("after")
      expect((yield* commands.list()).find((item) => item.name === "reload-command")?.template).toContain("after")
    }),
  { git: true },
)
