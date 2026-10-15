import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { Deferred, Effect, Fiber } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@apexo/core/process"
import { Seatbelt } from "@apexo/core/command-sandbox/seatbelt"
import { LayerNode } from "@apexo/core/effect/layer-node"

const layer = LayerNode.compile(AppProcess.node)

test("AppProcess observes live bytes once before bounded final capture without changing process identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-process-observer-"))
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const appProcess = yield* AppProcess.Service
        const seen = yield* Deferred.make<void>()
        const chunks: Uint8Array[] = []
        const completed = { value: false }
        const fiber = yield* appProcess
          .run(
            ChildProcess.make(process.execPath, [
              "-e",
              `
        const fs = require('node:fs');
        process.stdout.write('PID=' + process.pid + '\\n😀BEGIN');
        const timer = setInterval(() => {
          if (!fs.existsSync(process.argv[1])) return;
          clearInterval(timer); process.stdout.write('END'); process.stderr.write('ERROR_中文');
        }, 10);
      `,
              path.join(root, "release"),
            ]),
            {
              maxOutputBytes: 4,
              maxErrorBytes: 4,
              onOutput: (chunk) =>
                Effect.gen(function* () {
                  if (chunk.channel === "stdout") chunks.push(chunk.data.slice())
                  if (Buffer.concat(chunks).toString().includes("BEGIN")) yield* Deferred.succeed(seen, undefined)
                }),
            },
          )
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                completed.value = true
              }),
            ),
            Effect.forkScoped,
          )
        yield* Deferred.await(seen)
        expect(completed.value).toBe(false)
        const pid = Number(
          Buffer.concat(chunks)
            .toString()
            .match(/PID=(\d+)/)?.[1],
        )
        expect(pid).toBeGreaterThan(0)
        process.kill(pid, 0)
        yield* Effect.promise(() => writeFile(path.join(root, "release"), "ready"))
        const result = yield* Fiber.join(fiber)
        expect(result.exitCode).toBe(0)
        expect(result.stdout.length).toBe(4)
        expect(result.stdoutTruncated).toBe(true)
        expect(result.stderrTruncated).toBe(true)
        expect(Buffer.concat(chunks).toString()).toBe(`PID=${pid}\n😀BEGINEND`)
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("combined observation keeps the original all-stream capture contract", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const appProcess = yield* AppProcess.Service
      const chunks: Uint8Array[] = []
      const result = yield* appProcess.run(
        ChildProcess.make(process.execPath, [
          "-e",
          'process.stdout.write("A".repeat(4096)); process.stderr.write("B".repeat(4096))',
        ]),
        {
          combineOutput: true,
          maxOutputBytes: 16,
          onOutput: (chunk) =>
            Effect.sync(() => {
              expect(chunk.channel).toBe("combined")
              chunks.push(chunk.data.slice())
            }),
        },
      )
      const output = Buffer.concat(chunks).toString()
      expect(output.replaceAll("A", "")).toBe("B".repeat(4096))
      expect(output.replaceAll("B", "")).toBe("A".repeat(4096))
      expect(result.output?.length).toBe(16)
      expect(result.outputTruncated).toBe(true)
      expect(result.stdout.length).toBe(0)
      expect(result.stderr.length).toBe(0)
    }).pipe(Effect.provide(layer)),
  )
})

test("interrupting an observer waiting on backpressure joins its real process", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const appProcess = yield* AppProcess.Service
      const observed = yield* Deferred.make<number>()
      const fiber = yield* appProcess
        .run(
          ChildProcess.make(process.execPath, [
            "-e",
            "process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)",
          ]),
          {
            onOutput: (chunk) =>
              Deferred.succeed(observed, Number(Buffer.from(chunk.data).toString())).pipe(Effect.andThen(Effect.never)),
          },
        )
        .pipe(Effect.forkScoped)
      const pid = yield* Deferred.await(observed)
      expect(pid).toBeGreaterThan(0)
      yield* Fiber.interrupt(fiber)
      expect(() => process.kill(pid, 0)).toThrow()
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
})

test("sandbox preview consumes a split handshake, preserves UTF-8 bytes, and fails closed on mismatch", () => {
  const prepare = () =>
    Seatbelt.prepare({
      workspace: "/tmp",
      temporary: "/tmp",
      home: "/tmp",
      cwd: "/tmp",
      profile: "workspace",
      protected: [],
      ancestors: [],
      shell: "/bin/sh",
      command: "printf visible",
    })
  const valid = prepare()
  const marker = valid.command.args.find((arg) => arg.startsWith("APEXO_COMMAND_SANDBOX_"))!
  const data = Buffer.from(marker + "😀visible")
  const result = Array.from(data).flatMap((byte) => {
    const output = valid.preview({ channel: "stdout", data: Uint8Array.of(byte) })
    return output ? [output] : []
  })
  expect(Buffer.concat(result).toString()).toBe("😀visible")
  const invalid = prepare()
  expect(invalid.preview({ channel: "stdout", data: Buffer.from("WRONG") })).toBeUndefined()
  expect(invalid.preview({ channel: "stdout", data: data })).toBeUndefined()
  expect(invalid.preview({ channel: "combined", data: data })).toBeUndefined()
})

test.skipIf(process.platform !== "darwin")(
  "actual confined live preview strips its handshake and retains final confirmation",
  async () => {
    const root = await mkdtemp(path.join(homedir(), ".apexo-live-sandbox-"))
    const temporary = path.join(root, "tmp")
    await mkdir(temporary)
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const appProcess = yield* AppProcess.Service
          const prepared = Seatbelt.prepare({
            workspace: root,
            temporary,
            home: temporary,
            cwd: root,
            profile: "workspace",
            protected: [],
            ancestors: [root],
            shell: "/bin/sh",
            command: "printf 'VISIBLE😀'; while [ ! -f release ]; do sleep 0.01; done; printf END; printf STDERR >&2",
          })
          const visible = yield* Deferred.make<void>()
          const chunks: Uint8Array[] = []
          const fiber = yield* appProcess
            .run(prepared.command, {
              maxOutputBytes: 1024,
              maxErrorBytes: 1024,
              onOutput: (chunk) =>
                Effect.gen(function* () {
                  const output = prepared.preview(chunk)
                  if (output?.length) chunks.push(output.slice())
                  if (Buffer.concat(chunks).toString().includes("VISIBLE😀"))
                    yield* Deferred.succeed(visible, undefined)
                }),
            })
            .pipe(Effect.forkScoped)
          yield* Deferred.await(visible)
          expect(Buffer.concat(chunks).toString()).toBe("VISIBLE😀")
          yield* Effect.promise(() => writeFile(path.join(root, "release"), "ready"))
          const result = yield* Fiber.join(fiber)
          const confirmed = prepared.confirm(result)
          expect(confirmed).toBeDefined()
          expect(confirmed?.stdout.toString()).toBe("VISIBLE😀END")
          expect(confirmed?.stderr.toString()).toBe("STDERR")
          expect(Buffer.concat(chunks).toString()).not.toContain("APEXO_COMMAND_SANDBOX_")
        }).pipe(Effect.scoped, Effect.provide(layer)),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test("startup callback stays inside process ownership and cancellation joins before returning", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const appProcess = yield* AppProcess.Service
      const started = yield* Deferred.make<number>()
      const fiber = yield* appProcess
        .run(ChildProcess.make(process.execPath, ["-e", "setInterval(() => {}, 1000)"]), {
          onStart: (pid) => Deferred.succeed(started, pid).pipe(Effect.andThen(Effect.never)),
        })
        .pipe(Effect.forkScoped)
      const pid = yield* Deferred.await(started)
      process.kill(pid, 0)
      yield* Fiber.interrupt(fiber)
      expect(() => process.kill(pid, 0)).toThrow()
    }).pipe(Effect.scoped, Effect.provide(layer)),
  )
})

test("spawn failure rejects without calling the startup callback", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const appProcess = yield* AppProcess.Service
      const called = { value: false }
      const result = yield* appProcess
        .run(ChildProcess.make("/apexo-nonexistent-command-fixture"), {
          onStart: () =>
            Effect.sync(() => {
              called.value = true
            }),
        })
        .pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      expect(called.value).toBe(false)
    }).pipe(Effect.provide(layer)),
  )
})
