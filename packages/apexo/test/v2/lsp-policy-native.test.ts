import { expect, test } from "bun:test"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { EventV2 } from "@apexo/core/event"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { PluginBundle } from "@apexo/core/plugin-bundle"
import { LSP } from "@apexo/core/lsp"
import { NativeLspClient } from "@apexo/core/lsp-client"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"

const fixture = path.join(import.meta.dir, "../fixture/lsp-native-stdio.ts")
const trace = async (file: string) =>
  (
    await Bun.file(file)
      .text()
      .catch(() => "")
  )
    .split("\n")
    .filter(Boolean)
    .map((line): { event: string; pid: number } => JSON.parse(line))
const starts = async (file: string) => (await trace(file)).filter((row) => row.event === "start")
const poll = async (check: () => Promise<boolean>, label: string, timeout = 10_000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(30)
  }
  throw new Error(`Timed out: ${label}`)
}
const dead = (pid: number) => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}
const app = (root: string) =>
  AppNodeBuilder.build(
    LayerNode.group([SessionV2.node, LocationServiceMap.node, EventV2.node, LocationRuntimeGuard.node]),
    [
      [
        Global.node,
        Layer.succeed(Global.Service)(
          Global.make({ data: path.join(root, "data"), config: path.join(root, "config"), home: root }),
        ),
      ],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  )

test("native LSP bounds hung startup and shutdown and reaps the direct child", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-policy-client-"))
  try {
    const mode = path.join(root, "mode")
    const log = path.join(root, "trace")
    await Bun.write(mode, "hang")
    const before = Date.now()
    await expect(
      NativeLspClient.create({
        command: [process.execPath, fixture],
        root,
        environment: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
        startupTimeout: 500,
        shutdownTimeout: 5000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow()
    expect(Date.now() - before).toBeLessThan(3000)
    await poll(async () => (await starts(log)).every((row) => dead(row.pid)), "hung startup reaped")
    await Bun.write(mode, "shutdown-hang")
    const client = await NativeLspClient.create({
      command: [process.execPath, fixture],
      root,
      environment: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
      shutdownTimeout: 150,
      signal: new AbortController().signal,
    })
    const closing = Date.now()
    await client.close()
    expect(Date.now() - closing).toBeLessThan(3000)
    expect((await trace(log)).some((row) => row.event === "shutdown")).toBe(true)
    await poll(async () => (await starts(log)).every((row) => dead(row.pid)), "hung shutdown reaped")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)

test("native LSP lifetime recovery budget survives successful restart and passive reads never replenish it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-policy-budget-"))
  const directory = path.join(root, "project")
  const log = path.join(root, "trace")
  await mkdir(directory)
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      lsp: {
        local: {
          command: [process.execPath, fixture],
          extensions: [".fixture"],
          restartOnCrash: true,
          maxRestarts: 1,
          env: { LSP_NATIVE_TRACE: log },
        },
      },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const guard = yield* LocationRuntimeGuard.Service
          const events = yield* EventV2.Service
          const observed: string[] = []
          const unsubscribe = yield* events.listen((event) =>
            event.type === "lsp.updated" && event.location?.directory === directory
              ? lsp.status.pipe(
                  Effect.map((status) => {
                    observed.push(status[0]?.status ?? "missing")
                  }),
                )
              : Effect.void,
          )
          yield* Effect.addFinalizer(() => unsubscribe)
          const active = yield* guard
            .use({ directory: AbsolutePath.make(directory) }, Effect.never)
            .pipe(Effect.forkScoped)
          yield* Effect.sleep("20 millis")
          yield* Effect.promise(async () => process.kill((await starts(log))[0].pid, "SIGKILL"))
          yield* Effect.sleep("1300 millis")
          expect((yield* Effect.promise(() => starts(log))).length).toBe(1)
          yield* Fiber.interrupt(active)
          yield* Effect.promise(() => poll(async () => (await starts(log)).length === 2, "allowed restart"))
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(log)).filter((row) => row.event === "initialized").length === 2,
              "replacement ready",
            ),
          )
          yield* Effect.promise(async () => process.kill((await starts(log))[1].pid, "SIGKILL"))
          yield* Effect.sleep("1500 millis")
          for (let index = 0; index < 5; index++) {
            const status = yield* lsp.status
            expect(status[0]?.status).toBe("failed")
            expect(status[0]?.error).toContain("budget exhausted")
            expect(status[0]?.operations).toEqual([])
          }
          expect((yield* Effect.promise(() => starts(log))).length).toBe(2)
          expect(observed).toContain("connected")
          expect(observed).toContain("failed")
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.scoped, Effect.provide(app(root))),
    )
    await poll(async () => (await starts(log)).every((row) => dead(row.pid)), "Location children reaped")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("native LSP explicit reload cancels an initializing recovery and an interrupted reload retains recovery eligibility", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-policy-reload-"))
  const directory = path.join(root, "project")
  const log = path.join(root, "trace")
  const mode = path.join(root, "mode")
  await mkdir(directory)
  await Bun.write(mode, "ready")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      lsp: {
        local: {
          command: [process.execPath, fixture],
          extensions: [".fixture"],
          restartOnCrash: true,
          maxRestarts: 3,
          timeout: { startup: 10_000 },
          env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
        },
      },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const runtime = yield* PluginBundleRuntime.Service
          yield* Effect.promise(async () => {
            await Bun.write(mode, "hang")
            process.kill((await starts(log))[0].pid, "SIGKILL")
          })
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(log)).filter((row) => row.event === "initialize").length === 2,
              "automatic candidate initializing",
            ),
          )
          yield* Effect.promise(() => Bun.write(mode, "ready"))
          const before = Date.now()
          yield* runtime.reload()
          expect(Date.now() - before).toBeLessThan(4000)
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          expect((yield* Effect.promise(() => starts(log))).length).toBe(3)
          expect(dead((yield* Effect.promise(() => starts(log)))[1].pid)).toBe(true)
          yield* Effect.promise(() => Bun.write(mode, "hang"))
          const reload = yield* runtime.reload().pipe(Effect.forkScoped)
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(log)).filter((row) => row.event === "initialize").length === 4,
              "manual candidate initializing",
            ),
          )
          yield* Fiber.interrupt(reload)
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          yield* Effect.promise(async () => {
            await Bun.write(mode, "ready")
            process.kill((await starts(log))[2].pid, "SIGKILL")
          })
          yield* Effect.promise(() =>
            poll(async () => (await starts(log)).length === 5, "retained generation can recover"),
          )
          yield* Effect.promise(() =>
            poll(
              async () => (await trace(log)).filter((row) => row.event === "initialized").length === 3,
              "recovery initialized",
            ),
          )
          expect((yield* lsp.status)[0]?.status).toBe("connected")
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.scoped, Effect.provide(app(root))),
    )
    await poll(async () => (await starts(log)).every((row) => dead(row.pid)), "all candidates reaped")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("native LSP failed recovery attempts exhaust a finite budget and Location disposal cancels a pending backoff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-policy-failure-"))
  const directory = path.join(root, "project")
  const log = path.join(root, "trace")
  const mode = path.join(root, "mode")
  await mkdir(directory)
  await Bun.write(mode, "ready")
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      lsp: {
        local: {
          command: [process.execPath, fixture],
          extensions: [".fixture"],
          restartOnCrash: true,
          maxRestarts: 2,
          env: { LSP_NATIVE_TRACE: log, LSP_NATIVE_MODE_FILE: mode },
        },
      },
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const runtime = yield* PluginBundleRuntime.Service
          yield* Effect.promise(async () => {
            await Bun.write(mode, "fail")
            process.kill((await starts(log))[0].pid, "SIGKILL")
          })
          yield* Effect.promise(() => poll(async () => (await starts(log)).length === 3, "two failed recovery starts"))
          yield* Effect.sleep("200 millis")
          expect((yield* lsp.status)[0]?.error).toContain("budget exhausted")
          yield* Effect.promise(() => Bun.write(mode, "ready"))
          yield* runtime.reload()
          expect((yield* lsp.status)[0]?.status).toBe("connected")
          yield* Effect.promise(async () => process.kill((await starts(log))[3].pid, "SIGKILL"))
          yield* Effect.sleep("100 millis")
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.scoped, Effect.provide(app(root))),
    )
    await Bun.sleep(1500)
    expect((await starts(log)).length).toBe(4)
    await poll(async () => (await starts(log)).every((row) => dead(row.pid)), "Location disposal reaps all processes")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("native LSP max0, restart defaultfalse, and initial startup failure never retry on passive status reads", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-policy-optin-"))
  const directory = path.join(root, "project")
  await mkdir(directory)
  await Bun.write(path.join(root, "hang"), "hang")
  const logs = Object.fromEntries(["zero", "default", "initial"].map((id) => [id, path.join(root, id + ".trace")]))
  await Bun.write(
    path.join(directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      lsp: Object.fromEntries(
        Object.entries(logs).map(([id, log]) => [
          id,
          {
            command: [process.execPath, fixture],
            extensions: ["." + id],
            ...(id === "default" ? {} : { restartOnCrash: true, maxRestarts: id === "zero" ? 0 : 2 }),
            timeout: { startup: id === "initial" ? 500 : 5000 },
            env: {
              LSP_NATIVE_TRACE: log,
              ...(id === "initial" ? { LSP_NATIVE_MODE_FILE: path.join(root, "hang") } : {}),
            },
          },
        ]),
      ),
    }),
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        yield* Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const runtime = yield* PluginBundleRuntime.Service
          for (const id of ["zero", "default"])
            yield* Effect.promise(async () => process.kill((await starts(logs[id]))[0].pid, "SIGKILL"))
          yield* Effect.sleep("1500 millis")
          for (let index = 0; index < 3; index++)
            expect((yield* lsp.status).every((status) => status.status === "failed")).toBe(true)
          for (const log of Object.values(logs)) expect((yield* Effect.promise(() => starts(log))).length).toBe(1)
          // A completed max0 worker must not leave a stale job entry that blocks
          // replacement admission or Location shutdown.
          yield* Effect.promise(() => Bun.write(path.join(root, "hang"), "ready"))
          yield* runtime.reload()
          expect((yield* lsp.status).every((status) => status.status === "connected")).toBe(true)
        }).pipe(Effect.provide(locations.get({ directory: AbsolutePath.make(directory) })))
      }).pipe(Effect.scoped, Effect.provide(app(root))),
    )
    for (const log of Object.values(logs))
      await poll(async () => (await starts(log)).every((row) => dead(row.pid)), "opt-in processes reaped")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("native plugin LSP policies consume both aliases, accept zero budgets and reject unsafe timer ranges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-lsp-policy-adapter-"))
  try {
    await Bun.write(path.join(root, "plugin.json"), JSON.stringify({ name: "policy" }))
    for (const fields of [
      { restartOnCrash: true, maxRestarts: 0, startupTimeout: 0, shutdownTimeout: 0 },
      { restart_on_crash: true, max_restarts: 0, startup_timeout: 0, shutdown_timeout: 0 },
    ]) {
      await Bun.write(
        path.join(root, ".lsp.json"),
        JSON.stringify({
          local: { command: process.execPath, extensionToLanguage: { ".fixture": "fixture" }, ...fields },
        }),
      )
      const result = await PluginBundle.read(root, "policy", { native: true })
      expect(result.config.lsp).toMatchObject({
        "policy:local": { restartOnCrash: true, maxRestarts: 0, timeout: { startup: 0, shutdown: 0 } },
      })
    }
    for (const fields of [
      { shutdownTimeout: -1 },
      { shutdownTimeout: 2_147_478_648 },
      { maxRestarts: 1, max_restarts: 2 },
      { startupTimeout: 2_147_483_648 },
      { shutdownTimeout: 1.5 },
      { maxRestarts: -1 },
      { maxRestarts: 4_294_967_296 },
      { restartOnCrash: "true" },
    ]) {
      await Bun.write(
        path.join(root, ".lsp.json"),
        JSON.stringify({
          local: { command: process.execPath, extensionToLanguage: { ".fixture": "fixture" }, ...fields },
        }),
      )
      await expect(PluginBundle.read(root, "policy", { native: true })).rejects.toThrow()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
