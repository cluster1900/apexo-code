import { emptyHookSelection } from "../fixture/hook-preferences"
import { hookTLS } from "../fixture/hook-tls"
import { expect, test } from "bun:test"
import path from "node:path"
import { HostHooks } from "@apexo/core/hooks"
import { loadBundleHooks } from "../../src/plugin/bundle-hooks"
import { tmpdir } from "../fixture/fixture"

test("host hooks discover TOML, JSON and registered paths while project trust fails closed", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  const project = path.join(tmp.path, ".grok/hooks/project.json")
  await Bun.write(
    path.join(home, "config.toml"),
    '[hooks]\n[[hooks.PreToolUse]]\nmatcher="read"\n[[hooks.PreToolUse.hooks]]\ntype="command"\ncommand="exit 0"\n',
  )
  await Bun.write(
    path.join(home, "hooks/global.json"),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "exit 0" }] }] } }),
  )
  await Bun.write(project, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "exit 0" }] }] } }))
  await Bun.write(
    path.join(tmp.path, "registered.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          { hooks: [{ type: "http", url: "http://127.0.0.1/private-token", env: { TOKEN: "secret-value" } }] },
        ],
      },
    }),
  )
  await Bun.write(
    path.join(home, "hooks-paths"),
    `${path.join(tmp.path, "registered.json")}\nrelative-path-is-ignored\n`,
  )
  const initial = await HostHooks.inspect(tmp.path, home)
  expect(initial.projectTrusted).toBe(false)
  expect(JSON.stringify(initial)).not.toContain("private-token")
  expect(JSON.stringify(initial)).not.toContain("secret-value")
  expect(initial.hooks.map((hook) => hook.event)).toEqual(["PreToolUse", "SessionStart", "PostToolUse"])
  expect(initial.diagnostics).toContain(
    "Project hooks are disabled until this exact workspace has a host folder-trust grant",
  )
  await Bun.write(path.join(home, "trusted_folders.toml"), `[folders.${JSON.stringify(tmp.path)}]\ntrusted=true\n`)
  expect((await HostHooks.inspect(tmp.path, home)).hooks.map((hook) => hook.event)).toContain("Stop")
  await Bun.write(path.join(home, "trusted_folders.toml"), "malformed [")
  expect((await HostHooks.inspect(tmp.path, home)).projectTrusted).toBe(false)
})

test("host command hooks use env, fail open on crashes, and deny on exit two", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(
    path.join(home, "hooks/policy.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: "[", hooks: [{ type: "command", command: "exit 2" }] },
          { matcher: "read", hooks: [{ type: "command", command: "exit 1" }] },
          {
            matcher: "write",
            hooks: [
              {
                type: "command",
                command: 'printf "%s" "$HOOK_REASON" >&2; exit 2',
                env: { HOOK_REASON: "policy denied" },
              },
            ],
          },
        ],
      },
    }),
  )
  expect(await loadBundleHooks(tmp.path, path.join(tmp.path, "plugins"), home, false, emptyHookSelection)).toEqual([])
  const hooks = (
    await loadBundleHooks(tmp.path, path.join(tmp.path, "plugins"), home, undefined, emptyHookSelection)
  )[0]!
  await hooks["tool.execute.before"]!({ tool: "read", sessionID: "s", callID: "c" }, { args: {} })
  await expect(
    hooks["tool.execute.before"]!({ tool: "write", sessionID: "s", callID: "c" }, { args: {} }),
  ).rejects.toThrow("policy denied")
  expect(JSON.stringify(await HostHooks.inspect(tmp.path, home))).not.toContain("HOOK_REASON")
})

test("host HTTP hooks deny with official permissionDecisionReason", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  const calls: unknown[] = []
  using tls = hookTLS()
  using server = Bun.serve({
    tls: tls.tls,
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls.push(await request.json())
      return Response.json({
        hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "http policy" },
      })
    },
  })
  await Bun.write(
    path.join(home, "hooks/http.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "http", url: server.url.href }] }] } }),
  )
  const hooks = (
    await loadBundleHooks(tmp.path, path.join(tmp.path, "plugins"), home, undefined, emptyHookSelection)
  )[0]!
  await expect(
    hooks["tool.execute.before"]!({ tool: "read", sessionID: "s", callID: "c" }, { args: { file: "x" } }),
  ).rejects.toThrow("http policy")
  expect(calls).toEqual([
    { session_id: "s", tool_name: "read", tool_input: { file: "x" }, hook_event_name: "PreToolUse", cwd: tmp.path },
  ])
})

test("host deadlines fail open and PostToolUse can replace model output", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(
    path.join(home, "hooks/lifecycle.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "sleep 30", timeout: 0.1 }] }],
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: `printf '%s' '${JSON.stringify({ hookSpecificOutput: { updatedToolOutput: "redacted result", additionalContext: "reviewed" } })}'`,
              },
            ],
          },
        ],
      },
    }),
  )
  const hooks = (
    await loadBundleHooks(tmp.path, path.join(tmp.path, "plugins"), home, undefined, emptyHookSelection)
  )[0]!
  await hooks["tool.execute.before"]!({ tool: "read", sessionID: "s", callID: "c" }, { args: {} })
  const result = { title: "Read", output: "private result", metadata: {} }
  await hooks["tool.execute.after"]!({ tool: "read", sessionID: "s", callID: "c", args: {} }, result)
  expect(result.output).toBe("redacted result\nreviewed")
})

test("official matcher names are exact and external aliases work for names and regex", () => {
  expect(HostHooks.matches("read_file", "read_file_extra")).toBe(false)
  expect(HostHooks.matches("Read|Bash", "read_file")).toBe(true)
  expect(HostHooks.matches("^Bash$", "run_terminal_cmd")).toBe(true)
  expect(HostHooks.matches("[", "read_file")).toBe(false)
})

test("host rewrites preserve argument identity for downstream schema and permission checks", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  await Bun.write(
    path.join(home, "hooks/rewrite.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: `printf '%s' '${JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "changed target", updatedInput: { target_file: "reviewed.txt" } } })}'`,
              },
            ],
          },
        ],
      },
    }),
  )
  const hooks = (
    await loadBundleHooks(tmp.path, path.join(tmp.path, "plugins"), home, undefined, emptyHookSelection)
  )[0]!
  const args: Record<string, unknown> = { target_file: "original.txt", limit: 10 }
  await hooks["tool.execute.before"]!({ tool: "read_file", sessionID: "s", callID: "c" }, { args })
  expect(args).toEqual({ target_file: "reviewed.txt" })
})

test("compaction and terminal failure observers receive lifecycle payloads", async () => {
  await using tmp = await tmpdir()
  const home = path.join(tmp.path, "home")
  const calls: Record<string, unknown>[] = []
  using tls = hookTLS()
  using server = Bun.serve({
    tls: tls.tls,
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls.push(await request.json())
      return Response.json({ decision: "block" })
    },
  })
  await Bun.write(
    path.join(home, "hooks/lifecycle.json"),
    JSON.stringify({
      hooks: Object.fromEntries(
        ["PreCompact", "PostCompact", "StopFailure"].map((event) => [
          event,
          [{ hooks: [{ type: "http", url: server.url.href }] }],
        ]),
      ),
    }),
  )
  const hooks = (
    await loadBundleHooks(tmp.path, path.join(tmp.path, "plugins"), home, undefined, emptyHookSelection)
  )[0]!
  await hooks["experimental.session.compacting"]!({ sessionID: "s" }, { context: [] })
  await hooks.event!({ event: { type: "session.compacted", properties: { sessionID: "s" } } })
  await hooks.event!({
    event: {
      type: "session.error",
      properties: { sessionID: "s", error: { name: "UnknownError", data: { message: "fixture failure" } } },
    },
  })
  expect(calls.map((call) => call.hook_event_name)).toEqual(["PreCompact", "PostCompact", "StopFailure"])
  expect(calls[2]?.error).toEqual({ name: "UnknownError", data: { message: "fixture failure" } })
})
