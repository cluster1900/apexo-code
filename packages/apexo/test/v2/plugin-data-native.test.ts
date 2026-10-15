import { expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { PluginStore } from "@apexo/core/plugin-store"
import { PluginBundleState } from "@apexo/core/plugin-bundle-state"
import { Global } from "@apexo/core/global"
import { HookDispatch } from "@apexo/core/hook-dispatch"
import { tmpdir } from "../fixture/fixture"

test("native plugin hooks receive owned persistent data instead of author-forged data aliases", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source")
  const data = path.join(tmp.path, "data")
  const store = path.join(data, "plugins")
  await Bun.write(path.join(source, "plugin.json"), JSON.stringify({ name: "durable-data" }))
  await Bun.write(
    path.join(source, "hooks/hooks.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `printf '{"data":"%s","alias":"%s"}' "$GROK_PLUGIN_DATA" "$CLAUDE_PLUGIN_DATA"`,
                env: { GROK_PLUGIN_DATA: "/forged", CLAUDE_PLUGIN_DATA: "/forged" },
              },
            ],
          },
        ],
      },
    }),
  )
  await PluginStore.mutate(store, { action: "install", source, trust: true })
  await Effect.runPromise(
    Effect.gen(function* () {
      const bundles = yield* PluginBundleState.Service
      const snapshot = yield* bundles.get
      const captured = snapshot.sources[0]
      const hook = (captured.hooks.Stop as { hooks: Record<string, unknown>[] }[])[0].hooks[0]
      const output = yield* Effect.promise(() =>
        HookDispatch.run(hook, "{}", captured.root, tmp.path, 1000, false, "Stop", undefined, "Stop", captured.data),
      )
      expect(output).not.toContain("/forged")
      expect(JSON.parse(output).data).toContain(path.join(store, "data"))
      expect(JSON.parse(output).alias).toBe(JSON.parse(output).data)
    }).pipe(
      Effect.provide(PluginBundleState.layer.pipe(Layer.provide(Layer.succeed(Global.Service)(Global.make({ data }))))),
      Effect.scoped,
    ),
  )
})

async function installed(root: string) {
  const source = path.join(root, "source")
  const store = path.join(root, "store")
  await Bun.write(path.join(source, "plugin.json"), JSON.stringify({ name: "durable-data" }))
  await Bun.write(path.join(source, "commands/state.md"), "Read persistent state")
  const result = await PluginStore.mutate(store, { action: "install", source, trust: true })
  return { source, store, id: result.items[0].id }
}

test("data survives update, disable, enable and keep-data reinstall, with exact trusted identity", async () => {
  await using tmp = await tmpdir()
  const input = await installed(tmp.path)
  const first = await PluginStore.capture(input.store)
  const directory = first.plugins[0].data
  await Bun.write(path.join(directory, "state"), "persistent")
  await first.release()
  await PluginStore.mutate(input.store, { action: "disable", id: input.id })
  const disabled = await PluginStore.capture(input.store)
  expect(disabled.plugins).toHaveLength(0)
  await disabled.release()
  await PluginStore.mutate(input.store, { action: "enable", id: input.id })
  await PluginStore.mutate(input.store, { action: "update", id: input.id, trust: true })
  const updated = await PluginStore.capture(input.store)
  expect(updated.plugins[0].data).toBe(directory)
  expect(await Bun.file(path.join(directory, "state")).text()).toBe("persistent")
  await updated.release()
  await PluginStore.mutate(input.store, { action: "uninstall", id: input.id, keepData: true })
  expect(await Bun.file(path.join(directory, "state")).text()).toBe("persistent")
  await PluginStore.mutate(input.store, { action: "install", source: input.source, trust: true })
  const reinstalled = await PluginStore.capture(input.store)
  expect(reinstalled.plugins[0].data).toBe(directory)
  await reinstalled.release()
  await PluginStore.mutate(input.store, { action: "uninstall", id: input.id })
  expect(await Bun.file(path.join(directory, "state")).exists()).toBe(false)
})

test("uninstall retires before deletion and a new install cannot reuse an epoch held by readers", async () => {
  await using tmp = await tmpdir()
  const input = await installed(tmp.path)
  const first = await PluginStore.capture(input.store)
  const other = await PluginStore.capture(input.store)
  const directory = first.plugins[0].data
  await Bun.write(path.join(directory, "state"), "active")
  const removed = await PluginStore.mutate(input.store, { action: "uninstall", id: input.id })
  expect(removed.retainedData).toEqual([{ id: input.id, reason: "readers" }])
  expect(await Bun.file(path.join(directory, "state")).text()).toBe("active")
  await PluginStore.mutate(input.store, { action: "install", source: input.source, trust: true })
  const next = await PluginStore.capture(input.store)
  expect(next.plugins[0].data).not.toBe(directory)
  await first.release()
  expect(await Bun.file(path.join(directory, "state")).exists()).toBe(true)
  await other.release()
  expect(await Bun.file(path.join(directory, "state")).exists()).toBe(false)
  expect((await PluginStore.catalog(input.store)).retainedData).toBeUndefined()
  await next.release()
})

test("data cleanup never follows a replaced epoch or parent symlink", async () => {
  const fs = await import("node:fs/promises")
  await using tmp = await tmpdir()
  const input = await installed(tmp.path)
  const captured = await PluginStore.capture(input.store)
  const directory = captured.plugins[0].data
  const outside = path.join(tmp.path, "outside")
  await fs.mkdir(outside)
  await Bun.write(path.join(outside, "state"), "outside")
  await fs.rm(directory, { recursive: true })
  await fs.symlink(outside, directory)
  await PluginStore.mutate(input.store, { action: "uninstall", id: input.id })
  await captured.release()
  expect(await Bun.file(path.join(outside, "state")).text()).toBe("outside")
  expect((await PluginStore.catalog(input.store)).retainedData).toEqual([{ id: input.id, reason: "ownership" }])
  await fs.rm(path.join(input.store, "data"), { recursive: true })
  await fs.symlink(outside, path.join(input.store, "data"))
  await PluginStore.mutate(input.store, { action: "install", source: input.source, trust: true })
  await expect(PluginStore.capture(input.store)).rejects.toThrow("parent ownership changed")
  expect(await Bun.file(path.join(outside, "state")).text()).toBe("outside")
})

test("native captured data expansion covers commands, agents, skills and process configuration", async () => {
  const { PluginBundle } = await import("@apexo/core/plugin-bundle")
  await using tmp = await tmpdir()
  const input = await installed(tmp.path)
  await Bun.write(path.join(input.source, "commands/state.md"), "Read ${GROK_PLUGIN_DATA}/state")
  await Bun.write(path.join(input.source, "agents/state.md"), "Read ${CLAUDE_PLUGIN_DATA}/state")
  await Bun.write(
    path.join(input.source, "skills/state/SKILL.md"),
    "---\nname: state\ndescription: state\n---\nRead ${GROK_PLUGIN_DATA}/state",
  )
  await Bun.write(
    path.join(input.source, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        state: { command: "node", args: ["${GROK_PLUGIN_DATA}/server.js"], env: { DATA: "${CLAUDE_PLUGIN_DATA}" } },
      },
    }),
  )
  await Bun.write(
    path.join(input.source, ".lsp.json"),
    JSON.stringify({
      state: { command: "node", args: ["${CLAUDE_PLUGIN_DATA}/lsp.js"], extensionToLanguage: { ".state": "state" } },
    }),
  )
  await PluginStore.mutate(input.store, { action: "update", id: input.id, trust: true })
  const captured = await PluginStore.capture(input.store)
  const plugin = captured.plugins[0]
  const bundle = await PluginBundle.read(plugin.root, plugin.item.name, { native: true, data: plugin.data })
  expect(bundle.config.command?.["durable-data:state"].template).toBe(`Read ${plugin.data}/state`)
  expect(bundle.config.agent?.["durable-data:state"].prompt).toBe(`Read ${plugin.data}/state`)
  expect(bundle.skills[0].content.trim()).toBe(`Read ${plugin.data}/state`)
  expect(bundle.config.mcp?.["durable-data:state"]).toMatchObject({
    command: ["node", `${plugin.data}/server.js`],
    environment: { DATA: plugin.data },
  })
  expect(bundle.config.lsp).toMatchObject({ "durable-data:state": { command: ["node", `${plugin.data}/lsp.js`] } })
  await captured.release()
})

test("a crashed coordinator leaves an unknown reader; uninstall reports deferred cleanup", async () => {
  await using tmp = await tmpdir()
  const input = await installed(tmp.path)
  const marker = path.join(tmp.path, "captured")
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import {Flock} from ${JSON.stringify(import.meta.resolve("@apexo/core/util/flock"))}; import {PluginStore} from ${JSON.stringify(import.meta.resolve("@apexo/core/plugin-store"))}; Flock.setGlobal({state:${JSON.stringify(Global.Path.state)}}); const captured=await PluginStore.capture(${JSON.stringify(input.store)}); await Bun.write(${JSON.stringify(marker)}, captured.plugins[0].data); setInterval(()=>{},1000);`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  )
  const deadline = Date.now() + 5000
  while (!(await Bun.file(marker).exists()) && Date.now() < deadline) await Bun.sleep(10)
  if (!(await Bun.file(marker).exists())) {
    child.kill("SIGKILL")
    await child.exited
    throw new Error(await new Response(child.stderr).text())
  }
  expect(await Bun.file(marker).exists()).toBe(true)
  const directory = await Bun.file(marker).text()
  await Bun.write(path.join(directory, "state"), "unknown-reader")
  child.kill("SIGKILL")
  await child.exited
  const removed = await PluginStore.mutate(input.store, { action: "uninstall", id: input.id })
  expect(removed.retainedData).toEqual([{ id: input.id, reason: "readers" }])
  expect(await Bun.file(path.join(directory, "state")).text()).toBe("unknown-reader")
})

test("separate native processes reopen the same owned data epoch", async () => {
  await using tmp = await tmpdir()
  const input = await installed(tmp.path)
  const invoke = async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `import {Flock} from ${JSON.stringify(import.meta.resolve("@apexo/core/util/flock"))}; import {PluginStore} from ${JSON.stringify(import.meta.resolve("@apexo/core/plugin-store"))}; Flock.setGlobal({state:${JSON.stringify(Global.Path.state)}}); const captured=await PluginStore.capture(${JSON.stringify(input.store)}); const file=captured.plugins[0].data+'/counter';const count=Number(await Bun.file(file).text().catch(()=>0))+1;await Bun.write(file,String(count)); console.log(JSON.stringify({data:captured.plugins[0].data,count})); await captured.release();`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(child.stdout).text()
    const errors = await new Response(child.stderr).text()
    expect(await child.exited, errors).toBe(0)
    return JSON.parse(output) as { data: string; count: number }
  }
  const first = await invoke()
  const second = await invoke()
  expect(second).toEqual({ data: first.data, count: 2 })
  await PluginStore.mutate(input.store, { action: "uninstall", id: input.id })
  expect(await Bun.file(path.join(first.data, "counter")).exists()).toBe(false)
})

test("Location disposal releases retired data only after captured native work has joined", async () => {
  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "source")
  const data = path.join(tmp.path, "data")
  const store = path.join(data, "plugins")
  await Bun.write(path.join(source, "plugin.json"), JSON.stringify({ name: "scoped-data" }))
  await Bun.write(path.join(source, "commands/state.md"), "Read state")
  const installed = await PluginStore.mutate(store, { action: "install", source, trust: true })
  const captured = { file: "" }
  await Effect.runPromise(
    Effect.gen(function* () {
      const bundles = yield* PluginBundleState.Service
      const snapshot = yield* bundles.get
      const plugin = snapshot.sources[0]
      captured.file = path.join(plugin.data!, "state")
      yield* Effect.promise(() => Bun.write(captured.file, "owned"))
      const result = yield* Effect.promise(() =>
        PluginStore.mutate(store, { action: "uninstall", id: installed.items[0].id }),
      )
      expect(result.retainedData?.[0].reason).toBe("readers")
      expect(yield* Effect.promise(() => Bun.file(captured.file).text())).toBe("owned")
      yield* Effect.promise(() =>
        HookDispatch.run(
          { type: "command", command: 'test -f "$GROK_PLUGIN_DATA/state"; printf \'{"alive":true}\'' },
          "{}",
          plugin.root,
          tmp.path,
          1000,
          false,
          "Stop",
          undefined,
          "Stop",
          plugin.data,
        ),
      )
    }).pipe(
      Effect.provide(PluginBundleState.layer.pipe(Layer.provide(Layer.succeed(Global.Service)(Global.make({ data }))))),
      Effect.scoped,
    ),
  )
  expect(await Bun.file(captured.file).exists()).toBe(false)
})
