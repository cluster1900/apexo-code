import { hookTLS } from "../fixture/hook-tls"
import { expect, test } from "bun:test"
import path from "node:path"
import { HostHooks } from "@apexo/core/hooks"
import { HookEnvironment } from "@apexo/core/hook-environment"
import { HookDispatch } from "@apexo/core/hook-dispatch"
import { tmpdir } from "../fixture/fixture"

test("environment expansion preserves shell modifiers, unknown references, and special parameters", () => {
  expect(
    HookEnvironment.expand("$VALUE/${VALUE}/${MISSING_HOOK_VALUE}/${VALUE:-$OTHER}/$$VALUE/$?", {
      VALUE: "",
      OTHER: "bad",
    }),
  ).toBe("//${MISSING_HOOK_VALUE}/${VALUE:-$OTHER}/$$VALUE/$?")
  expect(HookEnvironment.expand("${A:-${B}}/$B", { A: "a", B: "b" })).toBe("${A:-${B}}/b")
  expect(HookEnvironment.unresolved("$MISSING_HOOK_VALUE/${MISSING_HOOK_VALUE:-fallback}/$$VALUE", {})).toEqual([
    "MISSING_HOOK_VALUE",
  ])
})

test("command-local assignments and read variables remain available to the shell", async () => {
  await using tmp = await tmpdir()
  expect(
    await HookDispatch.run(
      {
        type: "command",
        command: `LOCAL_HOOK_VALUE=local; read -r HOOK_INPUT; printf '{"value":"%s:%s"}' "$LOCAL_HOOK_VALUE" "$HOOK_INPUT"`,
      },
      "input\n",
      tmp.path,
      tmp.path,
      1000,
      true,
      "Stop",
    ),
  ).toBe('{"value":"local:input"}')
})

test("host discovery expands configured values but preserves authentic runtime identity", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(
    path.join(home, "hooks/env.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "printf '%s' '{\"configured\":\"${VALUE}\"}'; printf '%s' \"$GROK_SESSION_ID|$GROK_WORKSPACE_ROOT|$GROK_HOOK_EVENT|$GROK_HOOK_NAME|${EMPTY_VALUE:-fallback}\" > identity.txt",
                env: {
                  VALUE: "configured",
                  EMPTY_VALUE: "",
                  GROK_SESSION_ID: "forged",
                  GROK_WORKSPACE_ROOT: "forged",
                  GROK_HOOK_EVENT: "forged",
                  GROK_HOOK_NAME: "forged",
                },
              },
            ],
          },
        ],
      },
    }),
  )
  const discovered = await HostHooks.discover(tmp.path, home)
  const groups = discovered.sources[0]!.hooks.Stop as { hooks: Record<string, unknown>[] }[]
  const hook = groups[0]!.hooks[0]!
  expect(hook.command).toContain('"configured":"configured"')
  expect(hook.command).toContain("$GROK_SESSION_ID")
  expect(hook.env).not.toHaveProperty("GROK_SESSION_ID")
  expect(
    await HookDispatch.run(
      hook,
      '{"session_id":"actual-session"}',
      home,
      tmp.path,
      1000,
      true,
      "Stop",
      undefined,
      "actual-hook",
    ),
  ).toBe('{"configured":"configured"}')
  expect(await Bun.file(path.join(tmp.path, "identity.txt")).text()).toBe(
    `actual-session|${tmp.path}|stop|actual-hook|fallback`,
  )
})

test("unset plain command variables fail before spawning while modifier defaults execute", async () => {
  await using tmp = await tmpdir()
  await expect(
    HookDispatch.run(
      { type: "command", command: "touch marker; echo $APEXO_HOOK_UNSET_105" },
      "{}",
      tmp.path,
      tmp.path,
      1000,
      true,
      "Stop",
    ),
  ).rejects.toThrow("unset environment variable")
  expect(await Bun.file(path.join(tmp.path, "marker")).exists()).toBe(false)
  expect(
    await HookDispatch.run(
      { type: "command", command: 'printf \'{"value":"%s"}\' "${APEXO_HOOK_UNSET_105:-fallback}"' },
      "{}",
      tmp.path,
      tmp.path,
      1000,
      true,
      "Stop",
    ),
  ).toBe('{"value":"fallback"}')
})

test("HTTP URLs resolve per-hook variables and authentic session identity at dispatch", async () => {
  await using tmp = await tmpdir()
  const paths: string[] = []
  using tls = hookTLS()
  const server = Bun.serve({
    tls: tls.tls,
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      paths.push(new URL(request.url).pathname)
      await request.text()
      return Response.json({ continue: true })
    },
  })
  try {
    expect(
      await HookDispatch.run(
        {
          type: "http",
          url: "${HOOK_ORIGIN}/$GROK_SESSION_ID",
          env: { HOOK_ORIGIN: server.url.origin, GROK_SESSION_ID: "forged" },
        },
        '{"session_id":"actual-session"}',
        tmp.path,
        tmp.path,
        1000,
        true,
        "Stop",
      ),
    ).toBe('{"continue":true}')
    expect(paths).toEqual(["/actual-session"])
  } finally {
    await server.stop(true)
  }
})
