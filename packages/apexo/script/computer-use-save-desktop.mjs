import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, realpath } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createApexoClient } from "../../sdk/js/src/v2/client.ts"
import { toolName } from "../../../plugins/computer-use/script/build.mjs"
import { deadline, poll } from "./grok-shell-fixture.mjs"

export async function startPackagedSaveDesktop(app, release, suiteOutput) {
  const executable = join(app, "Contents/MacOS", readBundleExecutable(app))
  await access(executable, constants.X_OK)
  const output = await mkdtemp(join(suiteOutput, "desktop-"))
  const desktopHome = join(output, "home")
  const workspace = join(output, "workspace")
  await Promise.all([mkdir(desktopHome), mkdir(workspace)])
  const directory = await realpath(workspace)
  const profile = release.legacyProfile
  const config = {
    model: "xai/grok-4.7",
    enabled_providers: ["xai"],
    snapshot: false,
    compaction: { auto: false },
    permission: { "*": "deny", ...profile.permission },
    agent: {
      build: {
        steps: 40,
        variant: "low",
        permission: { skill: "allow", search_tool: "allow", use_tool: "allow", ...profile.agent.build.permission },
      },
    },
  }
  await Bun.write(join(directory, "apexo.json"), JSON.stringify(config))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(APEXO_|OPENCODE_|OTEL_|XAI_|ELECTRON_RUN_AS_NODE$)|(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(key),
    ),
  )
  Object.assign(env, {
    APEXO_TEST_ONBOARDING: "1",
    CFFIXED_USER_HOME: desktopHome,
    APEXO_TEST_HOME: process.env.APEXO_TEST_HOME ?? homedir(),
    APEXO_TEST_MANAGED_CONFIG_DIR: join(output, "managed"),
    APEXO_CONFIG_CONTENT: JSON.stringify(config),
    APEXO_APP_DIR_NAME: "apexo",
    APEXO_DISABLE_MODELS_FETCH: "1",
    APEXO_DISABLE_FFF: "1",
    SHELL: "/bin/sh",
  })
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = reservation.port
  await reservation.stop(true)
  const desktop = Bun.spawn([executable, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"], {
    cwd: directory,
    env,
    stdout: Bun.file(join(output, "desktop.log")),
    stderr: Bun.file(join(output, "desktop-stderr.log")),
  })
  const browserSession = `apexo-save-${crypto.randomUUID().slice(0, 8)}`
  let endpoint
  const browser = async (...args) => {
    const child = Bun.spawn(
      ["bunx", "--no-install", "agent-browser", "--session", browserSession, "--cdp", endpoint, ...args],
      {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 45_000,
      },
    )
    const [code, result, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    assert.equal(code, 0, error || `Packaged Desktop renderer failed: ${args[0]}`)
    return result.trim()
  }
  const close = async () => {
    if (endpoint && desktop.exitCode === null) await browser("eval", "window.api.killSidecar()").catch(() => {})
    if (endpoint) await browser("close").catch(() => {})
    if (desktop.exitCode !== null || desktop.signalCode !== null) return
    desktop.kill("SIGTERM")
    await deadline(desktop.exited, 12_000, "owned packaged Desktop exit").catch(async () => {
      desktop.kill("SIGKILL")
      await desktop.exited
    })
  }

  try {
    endpoint = await poll(
      async () => {
        assert.equal(desktop.exitCode, null, `Packaged Desktop exited. Evidence: ${output}`)
        const tabs = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
          .then((response) => response.json())
          .catch(() => [])
        return tabs.find((tab) => tab.type === "page" && tab.url.startsWith("apexo://renderer/"))?.webSocketDebuggerUrl
      },
      "owned packaged Desktop renderer",
      45_000,
    )
    await browser("wait", "--fn", "!!window.api?.awaitInitialization")
    const runtimeProfile = JSON.parse(await browser("eval", "window.api.getRuntimeProfile()"))
    assert.equal(runtimeProfile.supported, true, "The package must use its default V1 sidecar")
    assert.equal(runtimeProfile.active, "apexo")
    const connection = JSON.parse(await browser("eval", "window.api.awaitInitialization()"))
    const baseURL = new URL(connection.url)
    assert.equal(baseURL.hostname, "127.0.0.1")
    const headers = connection.password
      ? {
          authorization: `Basic ${Buffer.from(`${connection.username ?? "apexo"}:${connection.password}`).toString("base64")}`,
        }
      : {}
    const legacy = createApexoClient({ baseUrl: baseURL.origin, headers })
    const request = (options) => ({ throwOnError: true, signal: options?.signal ?? AbortSignal.timeout(10_000) })
    assert.equal((await legacy.global.health(request())).data.healthy, true)
    await browser("eval", "window.api.finishFirstLaunchOnboarding(false)")
    const listing = (await legacy.provider.list({ directory }, request())).data
    assert.ok(listing.connected.includes("xai"), "Packaged Desktop must use an existing xAI sign-in")
    assert.ok(listing.all.find((provider) => provider.id === "xai")?.models["grok-4.7"])
    const manage = async (pluginStoreAction) =>
      (await legacy.plugins.manage({ pluginStoreAction }, request({ signal: AbortSignal.timeout(90_000) }))).data
    const added = await manage({ action: "add-source", source: release.catalog })
    const plugin = added.items.find((item) => item.name === "computer-use" && item.revision === release.sha)
    assert.ok(plugin, "The packaged backend discovered the catalog pin")
    const installed = await manage({ action: "install", id: plugin.id, trust: true })
    assert.equal(installed.items.find((item) => item.id === plugin.id)?.installedRevision, release.sha)
    assert.equal(installed.items.find((item) => item.id === plugin.id)?.installedVersion, release.version)
    assert.equal((await legacy.plugins.reload({ directory }, request())).data, true)
    const server = "computer-use:desktop"
    const status = async () => (await legacy.mcp.status({ directory }, request())).data[server]
    const initialStatus = await status()
    if (initialStatus?.status === "failed") {
      console.log(JSON.stringify({ stage: "packaged-mcp-connect-retry", status: initialStatus.status, output }))
      await legacy.mcp.connect({ directory, name: server }, request())
    }
    await poll(async () => (await status())?.status === "connected", "default packaged MCP connection", 25_000)

    // Map V1 direct and deferred calls to the same Session evidence used by the native runner.
    const sessionStatus = async (options) => (await legacy.session.status({ directory }, request(options))).data
    const client = {
      permissions: {
        list: async ({ sessionID }, options) =>
          (await legacy.permission.list({ directory }, request(options))).data
            .filter((item) => item.sessionID === sessionID)
            .map((item) => ({
              id: item.id,
              source: item.tool,
              action: desktopTool(item.permission) ?? item.permission,
            })),
        reply: async ({ requestID, reply, message }, options) =>
          (await legacy.permission.reply({ requestID, directory, reply, message }, request(options))).data,
      },
      messages: {
        list: async ({ sessionID, order, limit }, options) => {
          assert.equal(order, "asc")
          const history = (await legacy.session.messages({ directory, sessionID, limit }, request(options))).data
          return {
            data: history
              .toSorted((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id))
              .map(({ info, parts }) => ({
                id: info.id,
                type: info.role,
                time: info.time,
                text:
                  info.role === "user"
                    ? parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("\n")
                    : undefined,
                model: { providerID: info.providerID, id: info.modelID },
                finish: info.finish,
                error: info.error,
                content: parts.map(normalizeTool),
              })),
          }
        },
      },
      sessions: {
        active: async (options) =>
          Object.fromEntries(
            Object.entries(await sessionStatus(options)).filter(([, status]) => status.type !== "idle"),
          ),
        interrupt: async ({ sessionID }, options) =>
          (await legacy.session.abort({ directory, sessionID }, request(options))).data,
        wait: async ({ sessionID }, options) =>
          poll(
            async () => {
              const status = (await sessionStatus(options))[sessionID]
              return !status || status.type === "idle"
            },
            "packaged Desktop session settled",
            10_000,
          ),
      },
    }
    return {
      client,
      runtime: { output, env, close },
      bundle: release.bundle,
      session: async () =>
        (await legacy.session.create({ directory, title: "TextEdit Save regression" }, request())).data,
      prompt: async (sessionID, text) =>
        legacy.session.promptAsync(
          {
            directory,
            sessionID,
            agent: "build",
            model: { providerID: "xai", modelID: "grok-4.7" },
            variant: "low",
            parts: [{ type: "text", text }],
          },
          request(),
        ),
      openInput: async (sessionID) => {
        const route = `/server/${Buffer.from("sidecar").toString("base64url")}/session/${sessionID}`
        await browser("eval", "window.api.showWindow()")
        await browser(
          "eval",
          `(async()=>{const id=await window.api.getWindowID();localStorage.setItem('apexo.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)});return true})()`,
        )
        await browser("reload")
        await browser("wait", '[data-component="prompt-input"]')
        return {
          async submit(text) {
            await browser("fill", '[data-component="prompt-input"]', text)
            await browser("wait", '[data-action="prompt-submit"]:enabled')
            await browser("click", '[data-action="prompt-submit"]')
            await poll(
              async () => {
                const history = await client.messages.list({ sessionID, order: "asc", limit: 10 })
                return history.data.some((message) => message.type === "user" && message.text?.trimEnd() === text)
              },
              "packaged renderer admitted the exact Save prompt",
              10_000,
            )
            // Keep the fixture renderer out of the way while the model operates the native sheet.
            await browser("eval", 'window.api.runDesktopMenuAction("window.minimize")')
          },
          close() {},
        }
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

function desktopTool(name) {
  const match = /^computer-use_desktop__?(desktop_[a-z_]+)$/.exec(name)
  return match ? toolName(match[1]) : undefined
}

function normalizeTool(part) {
  if (part.type !== "tool") return part
  const deferred = part.tool === "use_tool"
  const name = desktopTool(deferred ? part.state.input?.tool_name : part.tool)
  return {
    id: part.callID,
    type: "tool",
    name: name ?? part.tool,
    state: {
      status: part.state.status,
      input: deferred && name ? part.state.input.tool_input : part.state.input,
      content: part.state.output === undefined ? undefined : [{ type: "text", text: part.state.output }],
      error: part.state.error === undefined ? undefined : { message: part.state.error },
    },
  }
}

function readBundleExecutable(app) {
  const result = Bun.spawnSync([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Print CFBundleExecutable",
    join(app, "Contents/Info.plist"),
  ])
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return result.stdout.toString().trim()
}
