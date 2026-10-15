// A child with the fixture's environment writes only through canonical stores.
import { Effect } from "effect"
import { MemoryCapture } from "@apexo/core/memory-capture"
import { Flock } from "@apexo/core/util/flock"
import { join } from "node:path"
const input = await Bun.stdin.json()
Flock.setGlobal({ state: process.env.XDG_STATE_HOME })
const output = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const store = yield* MemoryCapture.make(input, { recover: false, strictOwner: true })
      const note = yield* store.remember("Preserved source for explicit discard", () => true)
      const lease = yield* store.dreamClaim(
        { owner: `deleted:${input.sessionID}`, now: Date.now(), duration: 300000, ownership: "explicit" },
        () => true,
      )
      const source = yield* store.dreamInput(lease, Date.now(), () => true)
      yield* store.dreamPrepare(
        lease,
        [
          {
            action: "create",
            path: "topics/must-not-publish.md",
            content: "Never replay this abandoned plan",
            evidence: source.observations.map((item) => item.path),
          },
        ],
        Date.now(),
        () => true,
      )
      yield* store.dreamRelease(lease, Date.now())
      const global = yield* MemoryCapture.make({ ...input, scope: "global" }, { recover: false })
      const globalNote = yield* global.remember("Unrelated global knowledge", () => true)
      return { root: store.root.path, note: note.path, global: globalNote.path, lease }
    }),
  ),
)
await Bun.write(process.env.APEXO_RECOVERY_SEED_OUTPUT, JSON.stringify(output))
