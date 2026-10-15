import { expect } from "bun:test"
import { Effect } from "effect"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Match } from "@apexo/schema/filesystem"
import { Ripgrep } from "@apexo/core/ripgrep"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Ripgrep.node, CrossSpawnSpawner.node])))
for (const kind of ["changed", "symlink"] as const)
  it.live(`batch Rust regex searches only immutable bytes despite ${kind} live path`, () =>
    Effect.gen(function* () {
      const home = yield* tmpdirScoped()
      const external = yield* tmpdirScoped()
      const ripgrep = yield* Ripgrep.Service
      yield* Effect.promise(() => mkdir(path.join(home, "topics")))
      if (kind === "changed")
        yield* Effect.promise(() => writeFile(path.join(home, "topics/fact.md"), "NEW_SECRET live bytes"))
      if (kind === "symlink") {
        yield* Effect.promise(() => writeFile(path.join(external, "outside.md"), "OUTSIDE_SECRET bytes"))
        yield* Effect.promise(() => symlink(path.join(external, "outside.md"), path.join(home, "topics/fact.md")))
      }
      const rows = yield* ripgrep.grep({
        cwd: home,
        file: "topics/fact.md",
        content: "Bound immutable FACT\n",
        pattern: "(?i)fact|SECRET",
        limit: 60,
      })
      expect(rows.map((row) => row.text)).toEqual(["Bound immutable FACT\n"])
      expect(String(rows[0]?.entry.path)).toBe("topics/fact.md")
      expect(
        (yield* ripgrep
          .grep({ cwd: home, file: "topics/fact.md", content: "Bound immutable FACT", pattern: "[", limit: 60 })
          .pipe(Effect.result))._tag,
      ).toBe("Failure")
    }),
  )

it.live("immutable Rust regex pagination retains every byte offset beyond two full pages", () =>
  Effect.gen(function* () {
    const home = yield* tmpdirScoped()
    const ripgrep = yield* Ripgrep.Service
    const content = Array.from({ length: 137 }, (_, index) => `猫 FACT ${index}\n`).join("")
    const rows: Match[] = []
    for (let page = 0; page < 3; page++) {
      const after = rows.at(-1)?.offset
      const matches = yield* ripgrep.grep({
        cwd: home,
        content,
        file: "topics/page.md",
        pattern: "FACT",
        limit: 60,
        ...(after === undefined ? {} : { afterOffset: after }),
      })
      rows.push(...matches)
    }
    expect(rows.map((row) => row.line)).toEqual(Array.from({ length: 137 }, (_, index) => index + 1))
    expect(new Set(rows.map((row) => row.offset)).size).toBe(137)
    expect(rows.at(-1)?.offset).toBe(Buffer.byteLength(content.slice(0, content.lastIndexOf("猫"))))
  }),
)
