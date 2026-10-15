import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@apexo/core/cross-spawn-spawner"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

it.live("retains stdout and stderr when a fast process exits before its consumer subscribes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [
          "-e",
          'process.stdout.write("STDOUT_😀"); process.stderr.write("STDERR_中文")',
        ]),
      )
      // Waiting for close deterministically reproduces a late consumer without a timing sleep.
      expect(Number(yield* handle.exitCode)).toBe(0)
      const stdout = yield* Stream.runCollect(Stream.decodeText(handle.stdout))
      const stderr = yield* Stream.runCollect(Stream.decodeText(handle.stderr))
      expect(stdout.join("")).toBe("STDOUT_😀")
      expect(stderr.join("")).toBe("STDERR_中文")
    }),
  ),
)

it.live("drains output larger than pipe buffers without blocking either stream", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [
          "-e",
          'process.stdout.write("A".repeat(1024 * 1024)); process.stderr.write("B".repeat(1024 * 1024))',
        ]),
      )
      const chunks = yield* Stream.runCollect(Stream.merge(handle.stdout, handle.stderr))
      const output = Buffer.concat(chunks).toString()
      expect(output.replaceAll("B", "").length).toBe(1024 * 1024)
      expect(output.replaceAll("A", "").length).toBe(1024 * 1024)
      expect(Number(yield* handle.exitCode)).toBe(0)
    }),
  ),
)
