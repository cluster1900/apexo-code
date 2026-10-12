import { expect } from "bun:test"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { cliIt } from "../lib/cli-process"

cliIt.live(
  "debug skill attach lists and reloads V1 and V2 skills",
  ({ home, apexo }) =>
    Effect.gen(function* () {
      const directory = path.join(home, ".apexo", "skills", "debug-skill")
      yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "SKILL.md"),
          "---\nname: debug-skill\ndescription: before\n---\n\nbefore\n",
        ),
      )
      const server = yield* apexo.serve()

      for (const protocol of ["v1", "v2"] as const) {
        const listed = yield* apexo.spawn([
          "debug",
          "skill",
          "--attach",
          server.url,
          "--protocol",
          protocol,
          "--directory",
          home,
        ])
        apexo.expectExit(listed, 0, `${protocol} skill list`)
        expect(JSON.parse(listed.stdout)).toContainEqual(
          expect.objectContaining({ name: "debug-skill", description: "before" }),
        )
      }

      yield* Effect.promise(() =>
        Bun.write(path.join(directory, "SKILL.md"), "---\nname: debug-skill\ndescription: after\n---\n\nafter\n"),
      )
      const reloaded = yield* apexo.spawn([
        "debug",
        "skill",
        "--attach",
        server.url,
        "--protocol",
        "v2",
        "--directory",
        home,
        "--reload",
      ])
      apexo.expectExit(reloaded, 0, "v2 skill reload")
      expect(JSON.parse(reloaded.stdout)).toContainEqual(
        expect.objectContaining({ name: "debug-skill", description: "after" }),
      )
    }),
  60_000,
)
