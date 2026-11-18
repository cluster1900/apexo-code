import assert from "node:assert/strict"
import { cp, mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { spawn } from "node:child_process"
import { Apexo } from "../../client/src/index.ts"
import { permissionProfile, legacyPermissionProfile, toolName } from "../../../plugins/computer-use/script/build.mjs"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startComputerUseFixture(kind = "cli", options = {}) {
  const state = { steps: [], requests: [], results: [], hold: undefined }
  const runtime = await startShellFixture(kind, {
    deferBackend: true,
    async next({ body, input, ancillary }) {
      if (ancillary) return { content: "Computer Use test" }
      state.requests.push(body)
      const output = input.filter((item) => item.role === "tool" || item.type === "function_call_output")
      state.results = output
      const step = state.steps.shift()
      if (typeof step === "function") return step(output, body)
      return step ?? { content: "COMPUTER_USE_DONE" }
    },
  })
  try {
    const profile = permissionProfile("allow")
    const config = {
      model: "computer-fixture/model",
      snapshots: false,
      compaction: { auto: false },
      permissions: [{ action: "*", resource: "*", effect: "deny" }, ...profile.permissions],
      agents: {
        build: {
          permissions: [{ action: "skill", resource: "*", effect: "allow" }, ...profile.agents.build.permissions],
        },
        confirm: {
          permissions: [{ action: toolName("desktop_permissions"), resource: "*", effect: "ask" }],
        },
        cancel: {
          permissions: [{ action: toolName("desktop_wait"), resource: "*", effect: "allow" }],
        },
        "response-check": { steps: 1 },
      },
      providers: {
        "computer-fixture": {
          api: {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: runtime.env.XAI_BASE_URL,
            settings: { apiKey: "local-fixture" },
          },
          models: {
            model: {
              capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
      ...options.config,
    }
    // Exploratory Save-dialog test only; the distributed profile does not permit this extra tool.
    if (options.focus)
      config.agents.build.permissions.push({ action: toolName("desktop_focus_window"), resource: "*", effect: "allow" })
    if (options.legacy) {
      const profile = legacyPermissionProfile("allow")
      Object.keys(config).forEach((key) => delete config[key])
      Object.assign(config, {
        model: "computer-fixture/model",
        snapshot: false,
        compaction: { auto: false },
        permission: { "*": "deny", ...profile.permission },
        agent: {
          build: {
            permission: { skill: "allow", search_tool: "allow", use_tool: "allow", ...profile.agent.build.permission },
          },
        },
        provider: {
          "computer-fixture": {
            npm: "@ai-sdk/openai-compatible",
            options: { apiKey: "local-fixture", baseURL: runtime.env.XAI_BASE_URL },
            models: {
              model: {
                name: "Computer Use fixture",
                tool_call: true,
                attachment: true,
                limit: { context: 100000, output: 4096 },
                modalities: { input: ["text", "image"], output: ["text"] },
                provider: { npm: "@ai-sdk/openai-compatible", api: runtime.env.XAI_BASE_URL },
              },
            },
          },
        },
      })
    }
    runtime.env.APEXO_CONFIG_CONTENT = JSON.stringify(config)
    await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify(config))
    if (options.live) {
      // Use the existing Grok sign-in and the project's normal credential refresh path.
      delete runtime.env.XAI_API_KEY
      delete runtime.env.XAI_BASE_URL
      runtime.env.APEXO_TEST_HOME = process.env.APEXO_TEST_HOME ?? (await import("node:os")).homedir()
      config.model = "xai/grok-4.7"
      config.agents.build.steps = 40
      config.agents.build.variant = "low"
      config.providers = {
        xai: { models: { "grok-4.7": { capabilities: { tools: true, input: ["text", "image"], output: ["text"] } } } },
      }
      runtime.env.APEXO_CONFIG_CONTENT = JSON.stringify(config)
      await writeFile(join(runtime.directory, "apexo.json"), JSON.stringify(config))
    }
    if (options.pure) {
      const file = join(runtime.output, "native-server.mjs")
      await writeFile(
        file,
        `import {webHandler} from ${JSON.stringify(resolve("../server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:${new URL(runtime.url).port},idleTimeout:0,fetch:app.handler});process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
      )
      const child = spawn(process.execPath, [file], {
        cwd: runtime.directory,
        env: runtime.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const logs = []
      child.stdout.on("data", (chunk) => logs.push(chunk))
      child.stderr.on("data", (chunk) => logs.push(chunk))
      const exited = new Promise((resolve) => child.once("exit", resolve))
      const close = runtime.close
      runtime.close = async () => {
        child.kill("SIGTERM")
        await deadline(exited, 15_000, "owned native backend exit").catch(async () => {
          child.kill("SIGKILL")
          await exited
        })
        await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
        await close()
      }
      await poll(
        () =>
          fetch(`${runtime.url}/api/health`)
            .then((r) => r.ok)
            .catch(() => false),
        "native server readiness",
        30_000,
      )
    }
    if (!options.pure) await runtime.reopen()
    const location = { directory: runtime.directory }
    const client = Apexo.make({ baseUrl: runtime.url })
    const plugins = client["server.plugins"]
    const mcp = client["server.mcp"]
    const bundle = resolve(
      process.env.COMPUTER_USE_BUNDLE ?? "../../plugins/computer-use/dist/computer-use-darwin-arm64",
    )
    const source = join(runtime.output, "catalog")
    await mkdir(join(source, ".grok-plugin"), { recursive: true })
    await cp(bundle, join(source, "computer-use"), { recursive: true })
    await writeFile(
      join(source, ".grok-plugin/marketplace.json"),
      JSON.stringify({
        name: "Computer Use acceptance",
        plugins: [{ name: "computer-use", source: "./computer-use" }],
      }),
    )
    const catalog = await plugins.manage({ action: "add-source", source })
    const plugin = catalog.items.find((item) => item.name === "computer-use")
    assert.ok(plugin, "Computer Use bundle discovered")
    const install = async () => {
      await plugins.manage({ action: "install", id: plugin.id, trust: true })
      await plugins.reload({ location })
      assert.equal((await mcp.status({ location }))["computer-use:desktop"].status, "connected")
    }
    const session = () =>
      client.sessions.create({
        location,
        agent: "build",
        model: options.live
          ? { providerID: "xai", id: "grok-4.7", variant: "low" }
          : { providerID: "computer-fixture", id: "model" },
      })
    const prompt = async (sessionID, text, wait = true) => {
      const admitted = await client.sessions.prompt({
        sessionID,
        id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        prompt: { text },
      })
      if (wait)
        await client.sessions.wait({ sessionID }, { signal: AbortSignal.timeout(options.live ? 240_000 : 60_000) })
      return admitted
    }
    const pending = (sessionID) =>
      poll(async () => (await client.permissions.list({ sessionID }))[0], "desktop permission request")
    return { runtime, client, plugins, mcp, state, location, plugin, bundle, config, install, session, prompt, pending }
  } catch (error) {
    await runtime.close()
    throw error
  }
}
