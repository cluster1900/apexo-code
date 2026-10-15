import { expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AbsolutePath } from "@apexo/schema/schema"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Database } from "@apexo/core/database/database"
import { EventV2 } from "@apexo/core/event"
import { SessionV1 } from "@apexo/core/v1/session"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { SessionExecutionLocal } from "@apexo/core/session/execution/local"
import { SessionCommandSandbox } from "@apexo/core/session/command-sandbox"

const layer = AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionCommandSandbox.node, EventV2.node]), [
  [Database.node, Database.layerFromPath(":memory:")],
  [SessionExecution.node, SessionExecutionLocal.node],
])

test("actual native creation stores explicit off atomically before Created listeners and inherits private child policy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "apexo-sandbox-create-"))
  try {
    await writeFile(path.join(directory, "apexo.json"), JSON.stringify({ snapshots: false }))
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const policies = yield* SessionCommandSandbox.Service
        const events = yield* EventV2.Service
        const observed: string[] = []
        yield* events.listen((event) =>
          event.type !== SessionV1.Event.Created.type
            ? Effect.void
            : Effect.gen(function* () {
                const current = yield* policies.get(
                  (yield* Schema.decodeUnknownEffect(Schema.toType(SessionV1.Event.Created.data))(event.data))
                    .sessionID,
                )
                observed.push(current.profile)
              }).pipe(Effect.orDie),
        )
        const root = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        expect((yield* policies.get(root.id)).profile).toBe("off")
        expect(observed).toEqual(["off"])
        const child = yield* sessions.create({ parentID: root.id, location: root.location })
        expect((yield* policies.inspect(child.id)).parent?.createdEventID).toBe(
          (yield* policies.inspect(root.id)).created,
        )
        expect(observed).toEqual(["off", "off"])
        const adopted = yield* sessions.create({
          id: root.id,
          location: { directory: AbsolutePath.make("/does-not-exist") },
        })
        expect(adopted.id).toBe(root.id)
        const conflict = yield* sessions
          .create({
            id: root.id,
            commandSandbox: "workspace",
            location: { directory: AbsolutePath.make("/does-not-exist") },
          })
          .pipe(Effect.flip)
        expect(conflict._tag).toBe("CommandSandbox.Failure")
        expect((yield* policies.get(root.id)).profile).toBe("off")
        const raceID = SessionV2.ID.create()
        const results = yield* Effect.all(
          [
            sessions.create({ id: raceID, location: root.location }),
            sessions.create({ id: raceID, location: root.location }),
          ],
          { concurrency: "unbounded" },
        )
        expect(results.map((item) => item.id)).toEqual([raceID, raceID])
        expect((yield* policies.get(raceID)).profile).toBe("off")
        if (process.platform === "darwin") {
          const conflictingID = SessionV2.ID.create()
          const outcomes = yield* Effect.all(
            [
              sessions.create({ id: conflictingID, commandSandbox: "off", location: root.location }).pipe(Effect.exit),
              sessions
                .create({ id: conflictingID, commandSandbox: "workspace", location: root.location })
                .pipe(Effect.exit),
            ],
            { concurrency: "unbounded" },
          )
          expect(outcomes.filter(Exit.isSuccess).length).toBe(1)
          expect(outcomes.filter(Exit.isFailure).length).toBe(1)
        }
        const missing = yield* sessions
          .create({ parentID: SessionV2.ID.create(), location: root.location })
          .pipe(Effect.exit)
        expect(Exit.isFailure(missing)).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
