import { expect } from "bun:test"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Effect, Layer } from "effect"
import path from "path"
import { Command } from "@/command"
import { Skill } from "@/skill"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { TestInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Command.node, Skill.node, CrossSpawnSpawner.node])),
    testInstanceStoreLayer,
  ),
)

const grok = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Command.node, Skill.node, CrossSpawnSpawner.node]), [
      [RuntimeFlags.node, RuntimeFlags.layer({ runtimeProfile: "grok-build" })],
    ]),
    testInstanceStoreLayer,
  ),
)

grok.instance("Grok memory commands share the persisted tool operations", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const entries = yield* commands.list()
    for (const [name, operation] of Object.entries({
      memory: "read",
      remember: "remember",
      flush: "flush",
      dream: "dream",
    })) {
      expect(entries.find((command) => command.name === name)?.template).toContain(`operation=${operation}`)
      expect((yield* commands.get(name))?.source).toBe("command")
    }
  }),
)

grok.instance("Grok loop command uses the shared scheduler and asks for missing arguments", () =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const command = yield* commands.get("loop")
    expect(command?.source).toBe("command")
    expect(command?.template).toContain("scheduler_create")
    expect(command?.template).toContain("fire_immediately=true")
    expect(command?.template).toContain("ask the user")
    expect(command?.hints).toContain("$ARGUMENTS")
  }),
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
