import { expect } from "bun:test"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { AbsolutePath } from "@apexo/core/schema"
import { SkillV2 } from "@apexo/core/skill"
import { Effect } from "effect"
import path from "path"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

it.live("SkillV2.list rereads changed markdown", () =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (directory) =>
      Effect.gen(function* () {
        const skills = yield* SkillV2.Service
        const skillFile = path.join(directory.path, "reload-skill.md")

        yield* Effect.promise(() =>
          Bun.write(
            skillFile,
            `---
name: reload-skill
description: before
---

before
`,
          ),
        )

        yield* skills.transform((draft) =>
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(directory.path),
            }),
          ),
        )

        expect((yield* skills.list())[0]).toMatchObject({
          name: "reload-skill",
          description: "before",
          content: "\nbefore\n",
        })

        yield* Effect.promise(() =>
          Bun.write(
            skillFile,
            `---
name: reload-skill
description: after
---

after
`,
          ),
        )

        expect((yield* skills.list())[0]).toMatchObject({
          name: "reload-skill",
          description: "after",
          content: "\nafter\n",
        })
      }),
    (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
  ),
)
