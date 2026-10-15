import { emptyHookSelection } from "../fixture/hook-preferences"
import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundle } from "@apexo/core/plugin-bundle"
import { tmpdir } from "../fixture/fixture"
import { loadBundleHooks } from "../../src/plugin/bundle-hooks"

async function fixture(root: string) {
  const source = path.join(root, "catalog")
  const plugin = path.join(source, "plugins", "example")
  await Bun.write(
    path.join(source, ".grok-plugin", "marketplace.json"),
    JSON.stringify({
      name: "Test plugins",
      plugins: [{ name: "example", source: "./plugins/example", description: "Fixture plugin", version: "1.0" }],
    }),
  )
  await Bun.write(
    path.join(plugin, "plugin.json"),
    JSON.stringify({ name: "example", version: "1.0", description: "A working plugin" }),
  )
  await Bun.write(
    path.join(plugin, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Test skill\n---\nRead ${PLUGIN_ROOT}/data.txt",
  )
  await Bun.write(path.join(plugin, "commands", "greet.md"), "---\ndescription: Greet\n---\nSay hello")
  await Bun.write(
    path.join(plugin, "agents", "review.md"),
    "---\ndescription: Review code\npermissionMode: bypassPermissions\n---\nReview carefully",
  )
  await Bun.write(
    path.join(plugin, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        demo: { command: "node", args: ["${PLUGIN_ROOT}/server.js"], env: { ROOT: "${GROK_PLUGIN_ROOT}" } },
      },
    }),
  )
  await Bun.write(
    path.join(plugin, ".lsp.json"),
    JSON.stringify({ demo: { command: "demo-lsp", args: ["--stdio"], extensionToLanguage: { ".demo": "demo" } } }),
  )
  await Bun.write(path.join(plugin, "README.md"), "# Example\nA plugin for tests.")
  return { source, plugin, store: path.join(root, "store") }
}

test("browse, download, trust, enable, disable, update and uninstall share one durable registry", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  const initial = await PluginStore.mutate(f.store, { action: "add-source", source: f.source })
  const id = initial.items[0].id
  expect(initial.items[0].status).toBe("available")
  expect(await PluginStore.active(f.store)).toEqual([])
  await expect(PluginStore.mutate(f.store, { action: "install", id })).rejects.toThrow("--trust")
  const downloaded = await PluginStore.mutate(f.store, { action: "download", id })
  expect(downloaded.items[0].status).toBe("downloaded")
  expect(await PluginStore.active(f.store)).toEqual([])
  await PluginStore.mutate(f.store, { action: "disable", id })
  await expect(PluginStore.mutate(f.store, { action: "enable", id })).rejects.toThrow("--trust")
  await PluginStore.mutate(f.store, { action: "enable", id, trust: true })
  const enabled = await PluginStore.active(f.store)
  expect(enabled).toHaveLength(1)
  expect(enabled[0].item.components.map((v) => v.kind)).toEqual([
    "skills",
    "commands",
    "agents",
    "mcpServers",
    "lspServers",
  ])
  const bundle = await PluginBundle.read(enabled[0].root, "example")
  expect(bundle.skills[0].name).toBe("example:hello")
  expect(bundle.skills[0].content).toContain(enabled[0].root)
  expect(bundle.config.command?.["example:greet"].template).toBe("Say hello")
  expect(bundle.config.agent?.["example:review"]).toEqual({
    description: "Review code",
    mode: "subagent",
    prompt: "Review carefully",
  })
  expect(bundle.config.mcp?.["example:demo"]).toEqual({
    type: "local",
    command: ["node", path.join(enabled[0].root, "server.js")],
    cwd: enabled[0].root,
    environment: { ROOT: enabled[0].root },
  })
  expect((await PluginStore.detail(f.store, id)).readme).toContain("# Example")
  await PluginStore.mutate(f.store, { action: "disable", id })
  expect(await PluginStore.active(f.store)).toEqual([])
  await Bun.write(path.join(f.plugin, "plugin.json"), JSON.stringify({ name: "example", version: "2.0" }))
  const updated = await PluginStore.mutate(f.store, { action: "update", id, trust: true })
  expect(updated.items[0].installedVersion).toBe("2.0")
  expect(updated.items[0].status).toBe("disabled")
  expect(updated.items[0].path).not.toBe(enabled[0].root)
  const removed = await PluginStore.mutate(f.store, { action: "uninstall", id })
  expect(removed.items[0].status).toBe("available")
  expect(await PluginStore.active(f.store)).toEqual([])
})

test("failed update keeps the previous plugin intact; removing a source preserves installs", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  const catalog = await PluginStore.mutate(f.store, { action: "add-source", source: f.source })
  const id = catalog.items[0].id
  const installed = await PluginStore.mutate(f.store, { action: "install", id, trust: true })
  await Bun.write(path.join(f.plugin, ".mcp.json"), "invalid json")
  await expect(PluginStore.mutate(f.store, { action: "update", id, trust: true })).rejects.toThrow()
  expect((await PluginStore.catalog(f.store)).items[0].path).toBe(installed.items[0].path)
  const removed = await PluginStore.mutate(f.store, { action: "remove-source", id: catalog.items[0].sourceID })
  expect(removed.items[0].status).toBe("enabled")
  expect(await PluginStore.active(f.store)).toHaveLength(1)
})

test("rejects escaping catalog paths, symlinks and malicious Git arguments", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  await Bun.write(
    path.join(f.source, ".grok-plugin", "marketplace.json"),
    JSON.stringify({ name: "escape", plugins: [{ name: "bad", source: "../../" }] }),
  )
  await expect(PluginStore.mutate(f.store, { action: "add-source", source: f.source })).rejects.toThrow("escapes")
  await expect(
    PluginStore.mutate(f.store, { action: "install", source: "--upload-pack=bad", trust: true }),
  ).rejects.toThrow("Invalid")
  await fs.symlink(path.join(tmp.path, "outside"), path.join(f.plugin, "link"))
  await expect(PluginStore.mutate(f.store, { action: "install", source: f.plugin, trust: true })).rejects.toThrow(
    "symbolic",
  )
})

test("direct local install requires trust and namespace collisions cannot silently replace capabilities", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  const installed = await PluginStore.mutate(f.store, { action: "install", source: f.plugin, trust: true })
  expect(installed.items[0].name).toBe("example")
  const catalog = await PluginStore.mutate(f.store, { action: "add-source", source: f.source })
  const entry = catalog.items.find((v) => v.status === "available")!
  await expect(PluginStore.mutate(f.store, { action: "install", id: entry.id, trust: true })).rejects.toThrow(
    "other plugin",
  )
})

test("serializes simultaneous installs without losing registry entries", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  const other = path.join(tmp.path, "other")
  await Bun.write(path.join(other, "plugin.json"), '{"name":"other"}')
  await Bun.write(path.join(other, "skills", "hello", "SKILL.md"), "---\nname: hello\n---\nHello")
  await Promise.all(
    [f.plugin, other].map((source) => PluginStore.mutate(f.store, { action: "install", source, trust: true })),
  )
  expect((await PluginStore.active(f.store)).map((v) => v.item.name).sort()).toEqual(["example", "other"])
})

test("downloaded plugins install offline and repeated downloads keep their existing snapshot", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  const catalog = await PluginStore.mutate(f.store, { action: "add-source", source: f.source })
  const id = catalog.items[0].id
  const downloaded = await PluginStore.mutate(f.store, { action: "download", id })
  await fs.rm(f.source, { recursive: true })
  const repeated = await PluginStore.mutate(f.store, { action: "download", id })
  expect(repeated.items[0].path).toBe(downloaded.items[0].path)
  const installed = await PluginStore.mutate(f.store, { action: "install", id, trust: true })
  expect(installed.items[0].status).toBe("enabled")
  expect(installed.items[0].path).toBe(downloaded.items[0].path)
  expect((await PluginBundle.read(installed.items[0].path!, "example")).skills[0].name).toBe("example:hello")
})

test("SessionStart hooks run once per session and SessionEnd receives each started session", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  await Bun.write(
    path.join(f.plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "cat >> start.jsonl; printf '\\n' >> start.jsonl" }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: "cat >> end.jsonl; printf '\\n' >> end.jsonl" }] }],
      },
    }),
  )
  await PluginStore.mutate(f.store, { action: "install", source: f.plugin, trust: true })
  const hooks = (await loadBundleHooks(tmp.path, f.store, undefined, undefined, emptyHookSelection))[0]
  expect(await Bun.file(path.join(tmp.path, "start.jsonl")).exists()).toBe(false)
  for (const sessionID of ["first", "first", "second"]) {
    await hooks["chat.message"]!(
      { sessionID },
      {
        message: {
          id: "message",
          sessionID,
          role: "user",
          agent: "build",
          time: { created: 1 },
          model: { providerID: "test", modelID: "test" },
        },
        parts: [],
      },
    )
  }
  await hooks.dispose!()
  for (const file of ["start.jsonl", "end.jsonl"]) {
    const lines = (await Bun.file(path.join(tmp.path, file)).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(lines.map((item) => item.session_id)).toEqual(["first", "second"])
  }
})

test("trusted lifecycle hooks execute and deny tool calls without raising host permissions", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  await Bun.write(
    path.join(f.plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: 'printf \'%s\' \'{"hookSpecificOutput":{"additionalContext":"PLUGIN_CONTEXT"}}\'',
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "^blocked$",
            hooks: [{ type: "command", command: 'printf \'%s\' \'{"decision":"block","reason":"fixture denied"}\'' }],
          },
        ],
        PostToolUse: [
          {
            matcher: "^read$",
            hooks: [
              {
                type: "command",
                command: 'printf \'%s\' \'{"hookSpecificOutput":{"additionalContext":"PLUGIN_RESULT"}}\'',
              },
            ],
          },
        ],
      },
    }),
  )
  await PluginStore.mutate(f.store, { action: "install", source: f.plugin, trust: true })
  const hooks = (await loadBundleHooks(tmp.path, f.store, undefined, undefined, emptyHookSelection))[0]
  const output = { args: { path: "file" } }
  await hooks["tool.execute.before"]!({ tool: "read", sessionID: "test", callID: "call" }, output)
  await expect(
    hooks["tool.execute.before"]!({ tool: "blocked", sessionID: "test", callID: "call" }, output),
  ).rejects.toThrow("fixture denied")
  expect(output.args).toEqual({ path: "file" })
  const result = { title: "Read", output: "data", metadata: {} }
  await hooks["tool.execute.after"]!({ tool: "read", sessionID: "test", callID: "call", args: {} }, result)
  expect(result.output).toBe("data\nPLUGIN_RESULT")
})

test.skipIf(process.platform === "win32")("hook deadlines terminate processes that ignore SIGTERM", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  await Bun.write(
    path.join(f.plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "trap '' TERM; while :; do sleep 1; done", timeout: 0.1 }] },
        ],
      },
    }),
  )
  await PluginStore.mutate(f.store, { action: "install", source: f.plugin, trust: true })
  const hooks = (await loadBundleHooks(tmp.path, f.store, undefined, undefined, emptyHookSelection))[0]
  await expect(
    hooks["tool.execute.before"]!({ tool: "read", sessionID: "test", callID: "call" }, { args: {} }),
  ).rejects.toThrow("time or output limit")
})

test("HTTP hooks receive real tool input and can deny execution", async () => {
  await using tmp = await tmpdir()
  const f = await fixture(tmp.path)
  const received: unknown[] = []
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received.push(await request.json())
      return Response.json({ hookSpecificOutput: { permissionDecision: "deny" }, reason: "HTTP denied" })
    },
  })
  await Bun.write(
    path.join(f.plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "http", url: server.url.href }] }],
      },
    }),
  )
  await PluginStore.mutate(f.store, { action: "install", source: f.plugin, trust: true })
  const hooks = (await loadBundleHooks(tmp.path, f.store, undefined, undefined, emptyHookSelection))[0]
  await expect(
    hooks["tool.execute.before"]!({ tool: "read", sessionID: "test", callID: "call" }, { args: { file: "example" } }),
  ).rejects.toThrow("HTTP denied")
  expect(received).toEqual([
    {
      session_id: "test",
      tool_name: "read",
      tool_input: { file: "example" },
      hook_event_name: "PreToolUse",
      cwd: tmp.path,
    },
  ])
})
