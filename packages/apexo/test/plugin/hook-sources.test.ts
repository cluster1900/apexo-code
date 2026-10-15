import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Location } from "@apexo/schema/location"
import { HostHooks } from "@apexo/core/hooks"
import { HookPreferences } from "@apexo/core/hook-preferences"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { tmpdir } from "../fixture/fixture"

const json = (command: string) => JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } })
const toml = (commands: string[], value: string) =>
  commands
    .map(
      (command) =>
        `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand=${JSON.stringify(command)}\ntimeout=3\n[hooks.Stop.hooks.env]\nVALUE=${JSON.stringify(value)}\n`,
    )
    .join("\n")

test("additive layers replace duplicate slots by provenance without accepting document policy", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(path.join(home, "requirements.toml"), toml(["echo $VALUE", "echo requirements"], "requirements"))
  await Bun.write(path.join(home, "config.toml"), toml(["echo $VALUE", "echo user"], "user"))
  await Bun.write(
    path.join(home, "managed_config.toml"),
    toml(["echo managed-first", "echo $VALUE", "echo managed-last"], "managed") + '\npolicy="managed"\n',
  )
  await Bun.write(
    path.join(home, "hooks/file.json"),
    JSON.stringify({
      policy: "managed",
      provenance: "system_managed",
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo $VALUE", env: { VALUE: "file" } },
              { type: "command", command: "echo file", policy: "managed", enabled: false },
            ],
          },
        ],
      },
    }),
  )
  const registry = await HostHooks.discover(tmp.path, home, tmp.path)
  const inspection = HostHooks.inspection(registry)
  expect(inspection.hooks.map((hook) => hook.name)).toEqual([
    `${home}/managed_config.toml:Stop:1:0`,
    `${home}/requirements.toml:Stop:1:0`,
    `${home}/config.toml:Stop:1:0`,
    `${home}/managed_config.toml:Stop:0:0`,
    `${home}/managed_config.toml:Stop:2:0`,
    `${home}/hooks/file.json:Stop:0:1`,
  ])
  expect(registry.sources.map((source) => source.provenance)).toEqual([
    "user_managed",
    "user_requirements",
    "user",
    "user_managed",
    "file",
  ])
  expect(registry.sources.every((source) => Object.isFrozen(source))).toBe(true)
  expect(inspection.hooks.every((hook) => hook.configurable)).toBe(true)
  expect(registry.sources.every((source) => source.policy === undefined)).toBe(true)
  const winner = registry.sources[0]!
  const handler = (winner.hooks.Stop as { hooks: Record<string, unknown>[] }[])[0]!.hooks[0]!
  expect(handler.command).toBe("echo managed")
  expect(handler.timeout).toBe(3)
  expect(HostHooks.blocked(winner, handler, inspection.hooks[0]!.id, [inspection.hooks[0]!.id])).toBe(true)
  expect(inspection.hooks.at(-1)!.configuredEnabled).toBe(false)
})

test("malformed layers and event aliases do not erase valid peers; equal rank keeps first", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(path.join(home, "requirements.toml"), "[hooks\n")
  await Bun.write(path.join(home, "config.toml"), 'hooks.stop="invalid"\n' + toml(["echo user"], "user"))
  await Bun.write(path.join(home, "managed_config.toml"), toml(["echo managed"], "managed"))
  await Bun.write(path.join(home, "hooks/a.json"), json("echo file"))
  await Bun.write(path.join(home, "hooks/b.json"), json("echo file"))
  await Bun.write(path.join(home, "hooks/c.json"), "{broken")
  const result = await HostHooks.inspect(tmp.path, home, tmp.path)
  expect(result.hooks.map((hook) => hook.source)).toEqual([
    `${home}/config.toml`,
    `${home}/managed_config.toml`,
    `${home}/hooks/a.json`,
  ])
  expect(result.diagnostics).toHaveLength(3)
})

test("vendor imports default off and only host config can enable them; exact trust still gates projects", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "grok")
  const userHome = path.join(tmp.path, "user")
  const workspace = path.join(tmp.path, "project/nested")
  await Bun.write(
    path.join(workspace, ".grok/hooks/enable.json"),
    JSON.stringify({ hooks: { imports: { claude: true, cursor: true } } }),
  )
  await Bun.write(path.join(workspace, ".grok/config.toml"), "[hooks.imports]\nclaude=true\ncursor=true\n")
  for (const root of [userHome, workspace]) {
    await Bun.write(path.join(root, ".claude/settings.json"), json(`echo ${root} claude`))
    await Bun.write(path.join(root, ".claude/settings.local.json"), json(`echo ${root} local`))
    await Bun.write(path.join(root, ".cursor/hooks.json"), json(`echo ${root} cursor`))
  }
  await Bun.write(path.join(home, "managed_config.toml"), "[hooks.imports]\nclaude=true\ncursor=true\n")
  expect((await HostHooks.inspect(workspace, home, userHome)).hooks).toHaveLength(0)
  await Bun.write(path.join(home, "config.toml"), "[hooks.imports]\nclaude=true\ncursor=false\n")
  expect((await HostHooks.inspect(workspace, home, userHome)).hooks).toHaveLength(2)
  await Bun.write(
    path.join(home, "trusted_folders.toml"),
    `[folders.${JSON.stringify(path.dirname(workspace))}]\ntrusted=true\n`,
  )
  expect((await HostHooks.inspect(workspace, home, userHome)).hooks).toHaveLength(2)
  await Bun.write(path.join(home, "trusted_folders.toml"), `[folders.${JSON.stringify(workspace)}]\ntrusted=true\n`)
  expect((await HostHooks.inspect(workspace, home, userHome)).hooks).toHaveLength(4)
  await Bun.write(path.join(home, "config.toml"), "[hooks.imports]\nclaude=false\ncursor=true\n")
  const cursor = await HostHooks.inspect(workspace, home, userHome)
  expect(cursor.hooks).toHaveLength(2)
  expect(cursor.hooks.every((hook) => hook.source.endsWith(".cursor/hooks.json"))).toBe(true)
  await Bun.write(path.join(home, "config.toml"), '[hooks.imports]\nclaude="true"\ncursor=false\n')
  expect((await HostHooks.inspect(workspace, home, userHome)).hooks).toHaveLength(0)
})

test("real source snapshots keep choices and definitions until explicit reload", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(path.join(home, "managed_config.toml"), toml(["echo managed"], "managed"))
  await Bun.write(path.join(tmp.path, ".claude/settings.json"), json("echo imported"))
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* SessionHookSnapshot.Service
      const id = SessionSchema.ID.create()
      const owner = yield* service.registerLocation(
        Schema.decodeUnknownSync(Location.Ref)({ directory: tmp.path }),
        () => Effect.tryPromise(() => HostHooks.discover(tmp.path, home, tmp.path)),
        HookPreferences.make(path.join(tmp.path, "data")),
      )
      const first = yield* service.capture(owner, id)
      const hookID = HostHooks.inspection(first.registry).hooks[0]!.id
      const disabled = yield* service.preference(owner, id, hookID, false)
      expect(disabled.selection()).toMatchObject({ disabled: [hookID] })
      yield* Effect.promise(() => Bun.write(path.join(home, "config.toml"), "[hooks.imports]\nclaude=true\n"))
      expect(yield* service.capture(owner, id)).toBe(disabled)
      expect(HostHooks.inspection(disabled.registry).hooks).toHaveLength(1)
      const reloaded = yield* service.reload(owner, id)
      expect(HostHooks.inspection(reloaded.registry).hooks).toHaveLength(2)
      expect(reloaded.selection()).toMatchObject({ disabled: [hookID] })
      expect(Object.isFrozen(reloaded.registry.sources[0])).toBe(true)
      yield* Effect.promise(() => Bun.write(path.join(home, "config.toml"), "[hooks.imports]\nclaude=false\n"))
      expect(HostHooks.inspection((yield* service.reload(owner, id)).registry).hooks).toHaveLength(1)
    }).pipe(Effect.provide(SessionHookSnapshot.layer), Effect.scoped),
  )
})

test("settings paths are files, never implicit hook directories", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "grok")
  const userHome = path.join(tmp.path, "user")
  await Bun.write(path.join(home, "config.toml"), "[hooks.imports]\nclaude=true\ncursor=true\n")
  for (const file of [
    path.join(home, "requirements.toml"),
    path.join(home, "managed_config.toml"),
    path.join(userHome, ".claude/settings.json"),
    path.join(userHome, ".claude/settings.local.json"),
    path.join(userHome, ".cursor/hooks.json"),
  ])
    await Bun.write(path.join(file, "unexpected.json"), json(`echo ${file}`))
  const result = await HostHooks.inspect(tmp.path, home, userHome)
  expect(result.hooks).toHaveLength(0)
  const other = path.join(tmp.path, "other")
  await Bun.write(path.join(other, "config.toml/unexpected.json"), json("echo config-directory"))
  expect((await HostHooks.inspect(tmp.path, other, userHome)).hooks).toHaveLength(0)
})

test("Cursor imports accept supported grouped aliases but never execute flat native entries", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "grok")
  const userHome = path.join(tmp.path, "user")
  await Bun.write(path.join(home, "config.toml"), "[hooks.imports]\ncursor=true\n")
  await Bun.write(
    path.join(userHome, ".cursor/hooks.json"),
    JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: "echo flat-native" }] } }),
  )
  const flat = await HostHooks.inspect(tmp.path, home, userHome)
  expect(flat.hooks).toHaveLength(0)
  expect(flat.diagnostics.some((message) => message.includes("invalid hook handlers"))).toBe(true)
  await Bun.write(
    path.join(userHome, ".cursor/hooks.json"),
    JSON.stringify({ hooks: { beforeShellExecution: [{ hooks: [{ type: "command", command: "echo grouped" }] }] } }),
  )
  const grouped = await HostHooks.inspect(tmp.path, home, userHome)
  expect(grouped.hooks).toHaveLength(1)
  expect(grouped.hooks[0]!.event).toBe("PreToolUse")
  expect(grouped.hooks[0]!.supported).toBe(true)
})
