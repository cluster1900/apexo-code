import { emptyHookSelection } from "../fixture/hook-preferences"
import { expect, test } from "bun:test"
import path from "node:path"
import { HostHooks } from "@apexo/core/hooks"
import { SessionHookStop } from "@apexo/core/session/hook-stop"
import { SessionSchema } from "@apexo/core/session/schema"
import { SessionMessage } from "@apexo/core/session/message"
import { tmpdir } from "../fixture/fixture"

test("raw duplicates keep configuration environment and original surviving identity", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  const command = `printf '%s\\n' "$HOOK_VALUE|$GROK_HOOK_NAME" >> '${path.join(tmp.path, "trace")}'`
  await Bun.write(
    path.join(home, "config.toml"),
    `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand=${JSON.stringify(command)}\ntimeout=2\n[hooks.Stop.hooks.env]\nHOOK_VALUE="config"\n`,
  )
  await Bun.write(
    path.join(home, "hooks/duplicates.json"),
    JSON.stringify({
      hooks: {
        stop: [
          {
            hooks: [
              { type: "command", command, timeout: 5, env: { HOOK_VALUE: "file" } },
              { type: "command", command: `${command}; true`, env: { HOOK_VALUE: "unique" } },
            ],
          },
        ],
      },
    }),
  )
  const inspection = await HostHooks.inspect(tmp.path, home)
  expect(inspection.hooks.map((hook) => hook.name)).toEqual([
    `${path.join(home, "config.toml")}:Stop:0:0`,
    `${path.join(home, "hooks/duplicates.json")}:Stop:0:1`,
  ])
  expect(JSON.stringify(inspection)).not.toContain("HOOK_VALUE")
  const discovered = await HostHooks.discover(tmp.path, home)
  expect((discovered.sources[0]!.hooks.Stop as { hooks: Record<string, unknown>[] }[])[0]!.hooks[0]!.timeout).toBe(2)
  await SessionHookStop.dispatch({
    ...{
      registry: discovered,
      directory: tmp.path,
      home,
      enabled: true,
      engine: "v1",
      sessionID: SessionSchema.ID.create(),
      messageID: SessionMessage.ID.create(),
      continuations: 0,
    },
    selection: emptyHookSelection,
  })
  expect((await Bun.file(path.join(tmp.path, "trace")).text()).trim().split("\n")).toEqual([
    `config|${path.join(home, "config.toml")}:Stop:0:0`,
    `unique|${path.join(home, "hooks/duplicates.json")}:Stop:0:1`,
  ])
})

test("different raw expressions, events, URLs and matchers remain distinct", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(
    path.join(home, "hooks/distinct.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo $VALUE", env: { VALUE: "same" } },
              { type: "command", command: "echo ${VALUE}", env: { VALUE: "same" } },
              { type: "http", url: "https://localhost/a" },
              { type: "http", url: "https://localhost/b" },
              { type: "http", url: "https://localhost/a", timeout: 99 },
              { type: "http", url: "${ROOT}/a", env: { ROOT: "https://localhost" } },
            ],
          },
          { matcher: "Read", hooks: [{ type: "command", command: "echo $VALUE", env: { VALUE: "same" } }] },
        ],
        SessionStart: [{ hooks: [{ type: "command", command: "echo $VALUE", env: { VALUE: "same" } }] }],
      },
    }),
  )
  expect((await HostHooks.inspect(tmp.path, home)).hooks).toHaveLength(7)
})

test("unsupported handlers cannot shadow valid copies and project trust cannot replace global winner", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  const command = "printf '%s' '$VALUE'"
  await Bun.write(
    path.join(home, "hooks/global.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "prompt", command },
              { type: "command", command, env: { VALUE: "global" } },
            ],
          },
        ],
      },
    }),
  )
  await Bun.write(
    path.join(tmp.path, ".grok/hooks/project.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command, env: { VALUE: "project" } },
              { type: "command", command: "echo project-only" },
            ],
          },
        ],
      },
    }),
  )
  const untrusted = await HostHooks.inspect(tmp.path, home)
  expect(untrusted.hooks).toHaveLength(2)
  expect(untrusted.hooks[0]!.supported).toBe(false)
  expect(untrusted.hooks[1]!.name).toEndWith(":Stop:0:1")
  await Bun.write(path.join(home, "trusted_folders.toml"), `[folders.${JSON.stringify(tmp.path)}]\ntrusted=true\n`)
  const trusted = await HostHooks.inspect(tmp.path, home)
  expect(trusted.hooks).toHaveLength(3)
  expect(trusted.hooks[2]!.name).toEndWith("project.json:Stop:0:1")
  expect((await HostHooks.discover(tmp.path, home)).sources[0]!.hooks.Stop).toMatchObject([
    { hooks: [{ type: "prompt" }, { type: "command", command: "printf '%s' 'global'" }] },
  ])
})
