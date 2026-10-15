import { expect, test } from "bun:test"
import path from "node:path"
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Deferred, Effect, Exit, Fiber, Layer, type Scope } from "effect"
import { AppNodeBuilder } from "@apexo/core/effect/app-node-builder"
import { LayerNode } from "@apexo/core/effect/layer-node"
import { Global } from "@apexo/core/global"
import { LocationServiceMap } from "@apexo/core/location-service-map"
import { LocationRuntimeGuard } from "@apexo/core/location-runtime-guard"
import { Flock } from "@apexo/core/util/flock"
import { PluginBundleRuntime } from "@apexo/core/plugin-bundle-runtime"
import { MCP } from "@apexo/core/mcp"
import { McpPreferences } from "@apexo/core/mcp-preferences"
import { SessionV2 } from "@apexo/core/session"
import { SessionExecution } from "@apexo/core/session/execution"
import { AbsolutePath } from "@apexo/schema/schema"
const fixture = path.join(import.meta.dir, "../fixture/mcp-preferences-native-stdio.ts")
const trace = async (file: string) =>
  (
    await Bun.file(file)
      .text()
      .catch(() => "")
  )
    .split("\n")
    .filter(Boolean)
    .map((line): { event: string; pid: number } => JSON.parse(line))
const poll = (check: Effect.Effect<boolean>, label: string) =>
  Effect.gen(function* () {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      if (yield* check) return
      yield* Effect.sleep("25 millis")
    }
    throw new Error(`Timed out: ${label}`)
  })
const app = (root: string) =>
  AppNodeBuilder.build(LayerNode.group([SessionV2.node, LocationServiceMap.node, LocationRuntimeGuard.node]), [
    [
      Global.node,
      Layer.succeed(Global.Service)(
        Global.make({
          data: path.join(root, "data"),
          config: path.join(root, "config"),
          home: root,
        }),
      ),
    ],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
const owner = (directory: string) =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const locations = yield* LocationServiceMap.Service
    const session = yield* sessions.create({
      location: { directory: AbsolutePath.make(directory) },
    })
    return yield* MCP.Service.pipe(Effect.provide(locations.get(session.location)))
  })
const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "apexo-mcp-preferences-"))
  const directory = path.join(root, "project"),
    log = path.join(root, "trace"),
    mode = path.join(root, "mode")
  await writeFile(mode, "ready")
  const config = async (disabled = false, servers = true, location = directory) =>
    Bun.write(
      path.join(location, "apexo.json"),
      JSON.stringify({
        snapshots: false,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        mcp: {
          servers: servers
            ? {
                local: {
                  type: "local",
                  command: [process.execPath, fixture],
                  disabled,
                  timeout: { startup: 3000, request: 1000 },
                  environment: {
                    MCP_NATIVE_TRACE: log,
                    MCP_NATIVE_MODE_FILE: mode,
                  },
                },
              }
            : {},
        },
      }),
    )
  await config()
  return {
    root,
    directory,
    log,
    mode,
    config,
    data: path.join(root, "data"),
    location: { directory: AbsolutePath.make(directory) },
  }
}
const cleanup = async (root: string, log: string) => {
  for (const row of (await trace(log)).filter((row) => row.event === "start"))
    expect(() => process.kill(row.pid, 0)).toThrow()
  await rm(root, { recursive: true, force: true })
}
const run = <A, E>(
  root: string,
  body: Effect.Effect<A, E, SessionV2.Service | LocationServiceMap.Service | Scope.Scope>,
) => Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(app(root))))

test("saved choices survive new Location runtimes and remain isolated by full Location", async () => {
  const f = await setup()
  const second = path.join(f.root, "other")
  await f.config(false, true, second)
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const first = yield* owner(f.directory),
          other = yield* owner(second)
        yield* first.disconnect("local")
        expect((yield* first.status).local).toMatchObject({
          status: "disabled",
          preference: false,
          configuredEnabled: true,
        })
        expect((yield* other.status).local.status).toBe("connected")
      }),
    )
    const before = (await trace(f.log)).filter((row) => row.event === "start").length
    await run(
      f.root,
      Effect.gen(function* () {
        const first = yield* owner(f.directory),
          other = yield* owner(second)
        expect((yield* first.status).local).toMatchObject({
          status: "disabled",
          preference: false,
        })
        expect((yield* other.status).local.status).toBe("connected")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start")).toHaveLength(
          before + 1,
        )
        yield* first.connect("local")
        const file = McpPreferences.file(f.location, f.data)
        const saved = yield* Effect.promise(() => readFile(file, "utf8"))
        yield* first.retry("local")
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(saved)
        yield* first.resetPreference("local")
        expect((yield* first.status).local.preference).toBeUndefined()
        expect((yield* first.status).local.status).toBe("connected")
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("saved choice overrides disabled default until reset and cannot create a removed definition", async () => {
  const f = await setup()
  await f.config(true)
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        expect((yield* mcp.status).local).toMatchObject({
          status: "disabled",
          configuredEnabled: false,
        })
        yield* mcp.connect("local")
        expect((yield* mcp.status).local.preference).toBe(true)
      }),
    )
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        expect((yield* mcp.status).local.status).toBe("connected")
        yield* mcp.resetPreference("local")
        expect((yield* mcp.status).local).toMatchObject({
          status: "disabled",
          configuredEnabled: false,
        })
        expect((yield* mcp.status).local.preference).toBeUndefined()
        expect((yield* mcp.retry("local").pipe(Effect.flip)).code).toBe("invalid")
        expect((yield* mcp.status).local.status).toBe("disabled")
        yield* mcp.connect("local")
      }),
    )
    await f.config(false, false)
    const before = (await trace(f.log)).filter((row) => row.event === "start").length
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        expect(yield* mcp.status).toEqual({})
        expect((yield* mcp.connect("local").pipe(Effect.flip)).code).toBe("not_found")
      }),
    )
    expect((await trace(f.log)).filter((row) => row.event === "start")).toHaveLength(before)
    await f.config(true)
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        expect((yield* mcp.status).local.status).toBe("connected")
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("failed and canceled connection candidates preserve the saved choice", async () => {
  const f = await setup()
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        yield* mcp.disconnect("local")
        const file = McpPreferences.file(f.location, f.data)
        const saved = yield* Effect.promise(() => readFile(file, "utf8"))
        yield* Effect.promise(() => writeFile(f.mode, "fail"))
        expect((yield* mcp.connect("local").pipe(Effect.flip)).code).toBe("load")
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(saved)
        yield* Effect.promise(() => writeFile(f.mode, "hang"))
        const before = (yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start").length
        const waiting = yield* mcp.connect("local").pipe(Effect.forkScoped)
        yield* poll(
          Effect.promise(async () => (await trace(f.log)).filter((row) => row.event === "start").length > before),
          "candidate started",
        )
        yield* Fiber.interrupt(waiting)
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(saved)
        expect((yield* mcp.status).local.preference).toBe(false)
        yield* Effect.promise(() => writeFile(f.mode, "ready"))
        yield* mcp.connect("local")
        const enabled = yield* Effect.promise(() => readFile(file, "utf8"))
        yield* Effect.promise(() => writeFile(f.mode, "fail"))
        expect((yield* mcp.retry("local").pipe(Effect.flip)).code).toBe("load")
        expect((yield* mcp.status).local).toMatchObject({
          status: "connected",
          preference: true,
        })
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(enabled)
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("corrupt preferences fail closed without preventing Session construction or overwriting data", async () => {
  const f = await setup()
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        yield* mcp.disconnect("local")
      }),
    )
    const file = McpPreferences.file(f.location, f.data),
      saved = await readFile(file, "utf8")
    await writeFile(file, "{")
    const before = (await trace(f.log)).filter((row) => row.event === "start").length
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        expect((yield* mcp.status).local).toMatchObject({
          status: "failed",
          preferenceError: true,
        })
        expect((yield* mcp.connect("local").pipe(Effect.flip)).code).toBe("storage")
        expect((yield* mcp.resetPreference("local").pipe(Effect.flip)).code).toBe("storage")
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("{")
        expect((yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start")).toHaveLength(before)
        yield* Effect.promise(() => writeFile(file, saved))
        yield* mcp.resetPreference("local")
        expect((yield* mcp.status).local.status).toBe("connected")
        expect((yield* mcp.status).local.preferenceError).toBeUndefined()
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("store handles hostile names, concurrent writers, private modes, and rollback revision fencing", async () => {
  const f = await setup(),
    store = McpPreferences.make(f.location, f.data)
  try {
    for (const name of ["__proto__", "../../escape", "constructor", "plugin:%:*?\\"])
      await Effect.runPromise(store.change(name, false, () => Effect.void))
    await Promise.all(
      ["first", "second"].map((name) =>
        Effect.runPromise(McpPreferences.make(f.location, f.data).change(name, true, () => Effect.void)),
      ),
    )
    expect([...(await Effect.runPromise(store.read)).keys()]).toHaveLength(6)
    const file = McpPreferences.file(f.location, f.data),
      before = await readFile(file, "utf8")
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await readdir(path.dirname(file))).filter((name) => name.endsWith(".json"))).toHaveLength(1)
    expect(
      Exit.isFailure(
        await Effect.runPromise(store.change("first", false, () => Effect.fail("activation failed")).pipe(Effect.exit)),
      ),
    ).toBe(true)
    expect(await readFile(file, "utf8")).toBe(before)
    const newer = JSON.stringify({
      ...JSON.parse(before),
      revision: crypto.randomUUID(),
      servers: [{ server: "newer", enabled: false }],
    })
    const conflict = await Effect.runPromise(
      store
        .change("first", false, () =>
          Effect.promise(() => writeFile(file, newer)).pipe(Effect.andThen(Effect.fail("activation failed"))),
        )
        .pipe(Effect.flip),
    )
    expect(conflict).toMatchObject({ kind: "conflict" })
    expect(await readFile(file, "utf8")).toBe(newer)
    expect((await Effect.runPromise(store.read)).get("newer")).toBe(false)
  } finally {
    await cleanup(f.root, f.log)
  }
}, 15000)

test("failed atomic write retains bytes and does not run activation", async () => {
  const f = await setup(),
    store = McpPreferences.make(f.location, f.data)
  const file = McpPreferences.file(f.location, f.data)
  try {
    await Effect.runPromise(store.change("local", false, () => Effect.void))
    const saved = await readFile(file, "utf8"),
      called = { value: false }
    await chmod(path.dirname(file), 0o500)
    const result = await Effect.runPromise(
      store
        .change("local", true, () =>
          Effect.sync(() => {
            called.value = true
          }),
        )
        .pipe(Effect.flip),
    )
    expect(result).toMatchObject({ kind: "write" })
    expect(called.value).toBe(false)
    expect(await readFile(file, "utf8")).toBe(saved)
  } finally {
    await chmod(path.dirname(file), 0o700)
    await cleanup(f.root, f.log)
  }
}, 15000)

test("separate private processes preserve choices and serialize independent preference writers", async () => {
  const f = await setup()
  const worker = async (action: string, name?: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        path.join(import.meta.dir, "../fixture/mcp-preferences-native-worker.ts"),
        f.root,
        action,
        ...(name ? [name] : []),
      ],
      {
        env: {
          ...process.env,
          APEXO_TEST_HOME: f.root,
          XDG_DATA_HOME: path.join(f.root, "xdg-data"),
          XDG_CONFIG_HOME: path.join(f.root, "xdg-config"),
          XDG_STATE_HOME: path.join(f.root, "xdg-state"),
          XDG_CACHE_HOME: path.join(f.root, "xdg-cache"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, output + error).toBe(0)
    const line = output.split("\n").find((row) => row.startsWith("RESULT "))
    expect(line).toBeDefined()
    return JSON.parse(line!.slice(7))
  }
  try {
    expect((await worker("disconnect")).local.preference).toBe(false)
    expect((await worker("status")).local.status).toBe("disabled")
    expect((await trace(f.log)).filter((row) => row.event === "start")).toHaveLength(1)
    expect((await worker("connect")).local.preference).toBe(true)
    expect((await worker("status")).local.status).toBe("connected")
    await Promise.all([worker("store", "process-one"), worker("store", "process-two")])
    const saved = await Effect.runPromise(McpPreferences.make(f.location, f.data).read)
    expect(saved.get("process-one")).toBe(true)
    expect(saved.get("process-two")).toBe(true)
    expect(saved.get("local")).toBe(true)
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("retry rechecks a concurrent saved disable before publishing its candidate", async () => {
  const f = await setup()
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        yield* Effect.promise(() => writeFile(f.mode, "wait"))
        const before = (yield* Effect.promise(() => trace(f.log))).filter((row) => row.event === "start").length
        const pending = yield* mcp.retry("local").pipe(Effect.exit, Effect.forkScoped)
        yield* poll(
          Effect.promise(async () => (await trace(f.log)).filter((row) => row.event === "start").length > before),
          "retry candidate waiting",
        )
        yield* McpPreferences.make(f.location, f.data).change("local", false, () => Effect.void)
        yield* Effect.promise(() => writeFile(f.mode, "ready"))
        expect(Exit.isFailure(yield* Fiber.join(pending))).toBe(true)
        expect((yield* McpPreferences.make(f.location, f.data).read).get("local")).toBe(false)
        // The pre-existing runtime is retained; another process's choice is applied on reload.
        expect((yield* mcp.status).local).toMatchObject({
          status: "connected",
          preference: false,
        })
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("retained connection dying while a preference write waits cannot publish connected", async () => {
  const f = await setup()
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        const file = McpPreferences.file(f.location, f.data)
        const lease = yield* Effect.promise(() => Flock.acquire(file, { dir: path.join(path.dirname(file), ".locks") }))
        const pending = yield* mcp.connect("local").pipe(Effect.exit, Effect.forkScoped)
        yield* Effect.sleep("100 millis")
        const pid = (yield* Effect.promise(() => trace(f.log))).find((row) => row.event === "start")!.pid
        process.kill(pid, "SIGKILL")
        yield* poll(
          mcp.status.pipe(Effect.map((status) => status.local.status === "failed")),
          "retained connection closed",
        )
        yield* Effect.promise(() => lease.release())
        expect(Exit.isFailure(yield* Fiber.join(pending))).toBe(true)
        expect((yield* mcp.status).local.status).toBe("failed")
        expect((yield* McpPreferences.make(f.location, f.data).read).has("local")).toBe(false)
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("reload applies latest saved choice and workspace identities have independent storage", async () => {
  const f = await setup()
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        const store = McpPreferences.make(f.location, f.data)
        yield* store.change("local", false, () => Effect.void)
        expect((yield* mcp.status).local.status).toBe("connected")
        const sessions = yield* SessionV2.Service,
          locations = yield* LocationServiceMap.Service
        const session = yield* sessions.create({ location: f.location })
        yield* Effect.gen(function* () {
          const runtime = yield* PluginBundleRuntime.Service
          yield* runtime.reload()
        }).pipe(Effect.provide(locations.get(session.location)))
        expect((yield* mcp.status).local).toMatchObject({
          status: "disabled",
          preference: false,
        })
        const workspace = {
          ...f.location,
          workspaceID: "workspace-fixture" as typeof session.location.workspaceID,
        }
        const other = McpPreferences.make(workspace, f.data)
        yield* other.change("local", true, () => Effect.void)
        expect((yield* other.read).get("local")).toBe(true)
        expect((yield* store.read).get("local")).toBe(false)
        expect(McpPreferences.file(workspace, f.data)).not.toBe(McpPreferences.file(f.location, f.data))
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 30000)

test("canceling an action waiting for the preference lock saves no choice", async () => {
  const f = await setup()
  try {
    await run(
      f.root,
      Effect.gen(function* () {
        const mcp = yield* owner(f.directory)
        const file = McpPreferences.file(f.location, f.data)
        const lease = yield* Effect.acquireRelease(
          Effect.promise(() => Flock.acquire(file, { dir: path.join(path.dirname(file), ".locks") })),
          (lease) => Effect.promise(() => lease.release()),
        )
        const pending = yield* mcp.disconnect("local").pipe(Effect.exit, Effect.forkScoped)
        yield* Effect.sleep("100 millis")
        const before = Date.now()
        yield* Fiber.interrupt(pending)
        expect(Date.now() - before).toBeLessThan(2000)
        expect((yield* mcp.status).local.status).toBe("connected")
        expect((yield* McpPreferences.make(f.location, f.data).read).has("local")).toBe(false)
      }),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 15000)

test("canceling after preference lock acquisition releases its exact lease", async () => {
  const f = await setup(),
    store = McpPreferences.make(f.location, f.data)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const acquired = yield* Deferred.make<void>()
          const pending = yield* store
            .inspect(() => Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Effect.never)))
            .pipe(Effect.forkScoped)
          yield* Deferred.await(acquired)
          yield* Fiber.interrupt(pending)
          const before = Date.now()
          yield* store.change("local", true, () => Effect.void)
          expect(Date.now() - before).toBeLessThan(2000)
          expect((yield* store.read).get("local")).toBe(true)
        }),
      ),
    )
  } finally {
    await cleanup(f.root, f.log)
  }
}, 15000)
