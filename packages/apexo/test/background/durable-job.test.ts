import { describe, expect } from "bun:test"
import { Database } from "@apexo/core/database/database"
import { BackgroundJob } from "@apexo/core/background-job"
import { Deferred, Effect } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(Database.layerFromPath(":memory:"))

describe("background.job durable ownership", () => {
  it.live("persists completion and fences a stale owner after takeover", () =>
    Effect.gen(function* () {
      const first = yield* BackgroundJob.makeDurable
      const second = yield* BackgroundJob.makeDurable
      const staleRelease = yield* Deferred.make<void>()
      const job = yield* first.start({
        id: "job_fenced",
        type: "task",
        run: Deferred.await(staleRelease).pipe(Effect.as("stale")),
      })

      const blocked = yield* second.get(job.id)
      expect(blocked?.status).toBe("running")
      expect(blocked?.metadata?.blockedReason).toBe("process_restart")
      expect((yield* second.cancel(job.id))?.status).toBe("running")

      const resumed = yield* second.resume({ id: job.id, run: Effect.succeed("fresh") })
      expect(resumed?.status).toBe("running")
      expect((yield* second.wait({ id: job.id })).info?.output).toBe("fresh")

      yield* first.report({ id: job.id, output: "stale-report", metadata: { stale: true } })
      expect(yield* first.extend({ id: job.id, run: Effect.succeed("stale-extend") })).toBe(false)
      expect(yield* first.promote(job.id)).toBeUndefined()

      yield* Deferred.succeed(staleRelease, undefined)
      yield* first.wait({ id: job.id })
      expect((yield* first.get(job.id))?.output).toBe("fresh")
      expect((yield* first.get(job.id))?.status).toBe("completed")
      expect((yield* first.list()).find((item) => item.id === job.id)?.output).toBe("fresh")
      expect((yield* second.get(job.id))?.output).toBe("fresh")
      expect((yield* second.get(job.id))?.status).toBe("completed")
    }),
  )
})
