import { expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Location } from "@apexo/schema/location"
import { HostHooks } from "@apexo/core/hooks"
import { HookPreferences } from "@apexo/core/hook-preferences"
import { SessionHookSnapshot } from "@apexo/core/session/hook-snapshot"
import { SessionSchema } from "@apexo/core/session/schema"
import { PluginStore } from "@apexo/core/plugin-store"
import { loadBundleHooks } from "../../src/plugin/bundle-hooks"
import { emptyHookSelection } from "../fixture/hook-preferences"
import { tmpdir } from "../fixture/fixture"

const toml = (commands: string[], value: string, extra = "") =>
  [
    extra,
    ...commands.map(
      (command) =>
        `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand=${JSON.stringify(command)}\ntimeout=3\n[hooks.Stop.hooks.env]\nVALUE=${JSON.stringify(value)}\n`,
    ),
  ]
    .filter(Boolean)
    .join("\n")

test("administrator layers outrank user layers, stamp non-disableable managed policy, and verify Ed25519 signed_requirements", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "grok")
  const systemDir = path.join(tmp.path, "system")
  const userHome = path.join(tmp.path, "user")

  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString()

  const signedBody = toml(["echo $VALUE", "echo signed-only"], "signed_requirements")
  const signature = sign(null, Buffer.from(signedBody, "utf8"), privateKey).toString("base64")

  await Bun.write(path.join(systemDir, "requirements.pub"), publicPem)
  await Bun.write(
    path.join(systemDir, "requirements.toml"),
    toml(["echo $VALUE", "echo sys-req-only"], "system_requirements"),
  )
  await Bun.write(
    path.join(systemDir, "managed_config.toml"),
    toml(["echo $VALUE", "echo sys-managed-only"], "system_managed"),
  )
  await Bun.write(path.join(home, "requirements.signed.toml"), signedBody)
  await Bun.write(path.join(home, "requirements.signed.toml.sig"), signature)
  await Bun.write(path.join(home, "requirements.toml"), toml(["echo $VALUE", "echo user-req-only"], "user_requirements"))
  await Bun.write(path.join(home, "config.toml"), toml(["echo $VALUE", "echo user-only"], "user"))
  await Bun.write(
    path.join(home, "managed_config.toml"),
    toml(["echo $VALUE", "echo user-managed-only"], "user_managed") + '\npolicy="managed"\n',
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
              { type: "command", command: "echo file-only", policy: "managed" },
            ],
          },
        ],
      },
    }),
  )

  const registry = await HostHooks.discover(tmp.path, home, userHome, undefined, systemDir)
  const inspection = HostHooks.inspection(registry)

  // Shared "echo $VALUE" slot must be won by system_managed (rank 7), keeping its env expansion
  const sharedWinner = registry.sources[0]!
  expect(sharedWinner.provenance).toBe("system_managed")
  expect(sharedWinner.policy).toBe("managed")
  const sharedHandler = (sharedWinner.hooks.Stop as { hooks: Record<string, unknown>[] }[])[0]!.hooks[0]!
  expect(sharedHandler.command).toBe("echo system_managed")

  // Admin layers are non-configurable (managed), while user layers remain configurable
  const managedHooks = inspection.hooks.filter((h) => "readOnlyReason" in h && h.readOnlyReason === "managed")
  const userHooks = inspection.hooks.filter((h) => !("readOnlyReason" in h))
  expect(managedHooks.map((h) => h.source)).toEqual([
    `${systemDir}/managed_config.toml`,
    `${systemDir}/requirements.toml`,
    `${home}/requirements.signed.toml`,
    `${systemDir}/managed_config.toml`,
  ])
  expect(managedHooks.every((h) => h.configurable === false)).toBe(true)
  expect(userHooks.every((h) => h.configurable === true)).toBe(true)

  // Managed hooks cannot be blocked by user disabled list or enabled: false
  const managedID = managedHooks[0]!.id
  expect(HostHooks.blocked(sharedWinner, { ...sharedHandler, enabled: false }, managedID, [managedID])).toBe(false)

  // SessionHookSnapshot.preference refuses to disable a managed hook with read_only
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* SessionHookSnapshot.Service
      const sessionID = SessionSchema.ID.create()
      const owner = yield* service.registerLocation(
        Schema.decodeUnknownSync(Location.Ref)({ directory: tmp.path }),
        () => Effect.tryPromise(() => HostHooks.discover(tmp.path, home, userHome, undefined, systemDir)),
        HookPreferences.make(path.join(tmp.path, "data")),
      )
      yield* service.capture(owner, sessionID)
      const failure = yield* service.preference(owner, sessionID, managedID, false).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(SessionHookSnapshot.Failure)
      expect((failure as SessionHookSnapshot.Failure).code).toBe("read_only")
    }).pipe(Effect.provide(SessionHookSnapshot.layer), Effect.scoped),
  )
})

test("tampered signed_requirements is rejected and fail_closed suppresses all non-managed hooks", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "grok")
  const systemDir = path.join(tmp.path, "system")
  const userHome = path.join(tmp.path, "user")

  const { publicKey } = generateKeyPairSync("ed25519")
  const { privateKey: wrongPrivateKey } = generateKeyPairSync("ed25519")
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString()

  const signedBody = toml(["echo forged-signed"], "forged")
  const badSignature = sign(null, Buffer.from(signedBody, "utf8"), wrongPrivateKey).toString("base64")

  await Bun.write(path.join(systemDir, "requirements.pub"), publicPem)
  await Bun.write(
    path.join(systemDir, "requirements.toml"),
    toml(["echo sys-req"], "sys", "fail_closed = true\n"),
  )
  await Bun.write(path.join(home, "requirements.signed.toml"), signedBody)
  await Bun.write(path.join(home, "requirements.signed.toml.sig"), badSignature)
  await Bun.write(path.join(home, "config.toml"), toml(["echo user-hook"], "user"))

  const registry = await HostHooks.discover(tmp.path, home, userHome, undefined, systemDir)
  const inspection = HostHooks.inspection(registry)

  expect(inspection.diagnostics.some((d) => d.includes("signature"))).toBe(true)
  expect(registry.allowManagedHooksOnly).toBe(true)
  // Forged signed hook and user hook are both excluded; only system_requirements remains
  expect(inspection.hooks.map((h) => h.source)).toEqual([`${systemDir}/requirements.toml`])
})

test("allow_managed_hooks_only is tighten-only and suppresses user, project, and plugin bundle hooks", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "grok")
  const systemDir = path.join(tmp.path, "system")
  const userHome = path.join(tmp.path, "user")
  const store = path.join(tmp.path, "store")
  const pluginDir = path.join(tmp.path, "plugin")

  // Create and install a trusted plugin with a SessionStart hook
  await Bun.write(path.join(pluginDir, "plugin.json"), JSON.stringify({ name: "corp-plugin", version: "1.0.0" }))
  await Bun.write(
    path.join(pluginDir, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `printf PLUGIN_RAN >> '${tmp.path}/trace.txt'` }] }],
      },
    }),
  )
  await PluginStore.mutate(store, { action: "install", source: pluginDir, trust: true })

  // Set allow_managed_hooks_only = true in system_requirements, try to set false in user config & managed_config
  await Bun.write(
    path.join(systemDir, "requirements.toml"),
    [
      "[hooks]",
      "allow_managed_hooks_only = true",
      "[[hooks.SessionStart]]",
      "[[hooks.SessionStart.hooks]]",
      'type = "command"',
      `command = "printf MANAGED_RAN >> '${tmp.path}/trace.txt'"`,
    ].join("\n"),
  )
  await Bun.write(
    path.join(home, "config.toml"),
    [
      "[hooks]",
      "allow_managed_hooks_only = false",
      "[hooks.imports]",
      "claude = true",
      "[[hooks.SessionStart]]",
      "[[hooks.SessionStart.hooks]]",
      'type = "command"',
      `command = "printf USER_RAN >> '${tmp.path}/trace.txt'"`,
    ].join("\n"),
  )
  await Bun.write(
    path.join(home, "managed_config.toml"),
    "[hooks]\nallow_managed_hooks_only = false\n",
  )
  await Bun.write(
    path.join(userHome, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `printf CLAUDE_RAN >> '${tmp.path}/trace.txt'` }] }],
      },
    }),
  )

  const registry = await HostHooks.discover(tmp.path, home, userHome, undefined, systemDir)
  expect(registry.allowManagedHooksOnly).toBe(true)
  expect(HostHooks.inspection(registry).hooks.map((h) => h.source)).toEqual([`${systemDir}/requirements.toml`])

  const hooks = await loadBundleHooks(tmp.path, store, home, true, emptyHookSelection, systemDir)
  for (const hook of hooks) {
    await hook["chat.message"]?.(
      { sessionID: "sess-1" },
      {
        message: {
          id: "msg-1",
          sessionID: "sess-1",
          role: "user",
          agent: "build",
          time: { created: 1 },
          model: { providerID: "test", modelID: "test" },
        },
        parts: [],
      },
    )
  }
  const trace = await Bun.file(path.join(tmp.path, "trace.txt")).text()
  expect(trace).toBe("MANAGED_RAN")
})
