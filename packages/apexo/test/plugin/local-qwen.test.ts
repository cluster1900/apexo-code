import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { LocalQwenPlugin, createDynamicLocalQwenFetch } from "../../src/plugin/local-qwen"
import {
  LOCAL_QWEN_MODEL_ID,
  LOCAL_QWEN_PROVIDER_ID,
  installLocalQwen,
  isLocalQwenModelDownloaded,
  readLocalQwenState,
  runLocalQwenCommand,
  writeLocalQwenState,
} from "@apexo/core/local-qwen"
import type { Config, PluginInput } from "@apexo/plugin"
import type { Permission, UserMessage } from "@apexo/sdk"
import type { Model as ModelV2 } from "@apexo/sdk/v2"
import { PartID } from "../../src/session/schema"

async function withTempDirs(
  fn: (dirs: { root: string; cacheDir: string; stateDir: string; tmpDir: string; binDir: string }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apexo-local-qwen-test-"))
  const cacheDir = path.join(root, "cache", "models")
  const stateDir = path.join(root, "state")
  const tmpDir = path.join(root, "tmp")
  const binDir = path.join(root, "bin")
  try {
    await fn({ root, cacheDir, stateDir, tmpDir, binDir })
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

function stubPluginInput(directory: string): PluginInput {
  return {
    client: {} as PluginInput["client"],
    project: {
      id: "proj_test",
      worktree: directory,
      time: { created: Date.now() },
    } as PluginInput["project"],
    directory,
    worktree: directory,
    experimental_workspace: {
      register() {},
    },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: Bun.$ as unknown as PluginInput["$"],
  }
}

describe("LocalQwenPlugin lifecycle and auto-takeover", () => {
  test("remains dormant by default before user downloads model", async () => {
    await withTempDirs(async (dirs) => {
      expect(await isLocalQwenModelDownloaded(dirs)).toBe(false)
      const state = await readLocalQwenState(dirs)
      expect(state.enabled).toBe(false)

      const hooks = await LocalQwenPlugin(stubPluginInput(dirs.root), dirs)
      const cfg: Config = {}
      await hooks.config?.(cfg)
      expect(cfg.provider).toBeUndefined()

      const smallOut: { model?: unknown } = { model: undefined }
      await hooks["experimental.provider.small_model"]?.(
        { provider: { id: "openai", name: "OpenAI", env: [], models: {} } as never },
        smallOut as never,
      )
      expect(smallOut.model).toBeUndefined()

      const afterOut = {
        title: "test",
        output: "x".repeat(5_000),
        metadata: {},
      }
      await hooks["tool.execute.after"]?.(
        { tool: "bash", sessionID: "ses_1", callID: "call_1", args: {} },
        afterOut,
      )
      expect(afterOut.output.length).toBe(5_000)
    })
  })

  test("downloads model on demand, verifies sha256, and auto-takes over tasks", async () => {
    await withTempDirs(async (dirs) => {
      const fakeWeights = new TextEncoder().encode("GGUF_FAKE_QWEN_0_8B_WEIGHTS_PAYLOAD")
      const hasher = new Bun.CryptoHasher("sha256")
      hasher.update(fakeWeights)
      const expectedSha256 = hasher.digest("hex")

      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/weights/qwen-0.8b.gguf") {
            return new Response(fakeWeights, {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            })
          }
          if (url.pathname === "/v1/health" || url.pathname === "/health") {
            return Response.json({ status: "ok" })
          }
          if (url.pathname === "/v1/chat/completions") {
            const body = (await req.json()) as {
              messages: Array<{ role: string; content: string }>
            }
            const system = body.messages.find((m) => m.role === "system")?.content ?? ""
            const user = body.messages.find((m) => m.role === "user")?.content ?? ""

            if (system.includes("JSON syntax repair utility")) {
              return Response.json({
                choices: [{ message: { content: '<think>fixing</think>{"filePath":"src/app.ts","line":42}' } }],
              })
            }
            if (system.includes("concise CLI log compressor")) {
              return Response.json({
                choices: [
                  {
                    message: {
                      content: "FAIL test/auth.test.ts:18 - Expected 200, received 401\nExit code: 1",
                    },
                  },
                ],
              })
            }
            if (system.includes("Classify the coding prompt complexity")) {
              return Response.json({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        complexity: user.includes("architecture") ? "high" : "low",
                        intent: user.includes("architecture") ? "architecture" : "query",
                      }),
                    },
                  },
                ],
              })
            }
            if (system.includes("Assess the safety risk")) {
              const destructive = user.includes("rm -rf")
              return Response.json({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        risk: destructive ? "destructive" : "safe_readonly",
                        reason: destructive ? "Deletes files recursively" : "Lists git status only",
                      }),
                    },
                  },
                ],
              })
            }
            return Response.json({
              choices: [{ message: { content: "ok" } }],
            })
          }
          return new Response("Not Found", { status: 404 })
        },
      })

      try {
        const baseUrl = `http://127.0.0.1:${server.port}`
        const weightsUrl = `${baseUrl}/weights/qwen-0.8b.gguf`
        const endpointUrl = `${baseUrl}/v1`

        await expect(
          installLocalQwen({
            ...dirs,
            url: weightsUrl,
            expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
          }),
        ).rejects.toThrow("SHA256 mismatch")

        const progressUpdates: Array<{ loadedBytes: number; totalBytes?: number; percent?: number }> = []
        const installed = await installLocalQwen({
          ...dirs,
          url: weightsUrl,
          expectedSha256,
          onProgress: (p) => progressUpdates.push(p),
        })
        expect(installed.enabled).toBe(true)
        expect(await isLocalQwenModelDownloaded(dirs)).toBe(true)
        expect(progressUpdates.length).toBeGreaterThanOrEqual(2)
        expect(progressUpdates[progressUpdates.length - 1]?.percent).toBe(100)

        await runLocalQwenCommand(`endpoint ${endpointUrl}`, dirs)
        const stateAfterEndpoint = await readLocalQwenState(dirs)
        expect(stateAfterEndpoint.endpoint).toBe(endpointUrl)

        const options = {
          ...dirs,
          logCompressThreshold: 200,
        }
        const hooks = await LocalQwenPlugin(stubPluginInput(dirs.root), options)

        // 1. Config & Small Model Takeover
        const cfg: Config = {}
        await hooks.config?.(cfg)
        expect(cfg.provider?.[LOCAL_QWEN_PROVIDER_ID]?.models?.[LOCAL_QWEN_MODEL_ID]).toBeDefined()

        const smallOut: { model?: ModelV2 } = {}
        await hooks["experimental.provider.small_model"]?.(
          { provider: { id: "openai", name: "OpenAI", env: [], models: {} } as never },
          smallOut as never,
        )
        expect(smallOut.model?.id).toBe(LOCAL_QWEN_MODEL_ID)
        expect(smallOut.model?.providerID).toBe(LOCAL_QWEN_PROVIDER_ID)
        expect(smallOut.model?.cost).toEqual({
          input: 0,
          output: 0,
          cache: { read: 0, write: 0 },
        })

        // 2. Tool Argument Schema Self-Healing (tool.execute.before)
        const beforeOut = {
          args: {
            validWrappedJson: '{"nested":true}',
            brokenJson: '{filePath: "src/app.ts", line: 42}',
            oldString: '{"keepAsString":true}',
            newString: '{brokenButKeepAsString: true}',
          } as Record<string, unknown>,
        }
        await hooks["tool.execute.before"]?.(
          { tool: "edit", sessionID: "ses_1", callID: "call_heal" },
          beforeOut,
        )
        expect(beforeOut.args.validWrappedJson).toEqual({ nested: true })
        expect(beforeOut.args.brokenJson).toEqual({ filePath: "src/app.ts", line: 42 })
        expect(typeof beforeOut.args.oldString).toBe("string")
        expect(typeof beforeOut.args.newString).toBe("string")

        // Write tool must never parse JSON file content strings into objects
        const writeOut = {
          args: {
            filePath: "/tmp/package.json",
            content: '{\n  "name": "demo",\n  "version": "1.0.0"\n}',
          } as Record<string, unknown>,
        }
        await hooks["tool.execute.before"]?.(
          { tool: "write", sessionID: "ses_1", callID: "call_write_json" },
          writeOut,
        )
        expect(typeof writeOut.args.content).toBe("string")
        expect(writeOut.args.content).toBe('{\n  "name": "demo",\n  "version": "1.0.0"\n}')

        // Dynamic fetch must rewrite stale cached ports to current live endpoint
        const dynamicFetch = createDynamicLocalQwenFetch(dirs)
        const reroutedRes = await dynamicFetch("http://127.0.0.1:59999/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
        })
        expect(reroutedRes.ok).toBe(true)

        // 3. Long Tool Output Dehydration (tool.execute.after)
        const noisyLog = [
          "PASS test/unit-1.test.ts",
          "PASS test/unit-2.test.ts\n".repeat(40),
          "FAIL test/auth.test.ts:18 - Expected 200, received 401",
          "Exit code: 1",
        ].join("\n")
        const afterOut = {
          title: "bun test",
          output: noisyLog,
          metadata: {} as Record<string, unknown>,
        }
        await hooks["tool.execute.after"]?.(
          { tool: "bash", sessionID: "ses_1", callID: "call_log_1", args: {} },
          afterOut,
        )
        expect(afterOut.output).toContain("FAIL test/auth.test.ts:18")
        expect(afterOut.output).toContain("Local Qwen 0.8B compressed")
        expect(afterOut.metadata.localQwenCompressed).toBe(true)
        const savedPath = String(afterOut.metadata.fullOutputPath)
        expect(await Bun.file(savedPath).text()).toBe(noisyLog)

        // 4. Prompt Complexity & Effort Triage (chat.message + chat.params)
        const userMessage: UserMessage = {
          id: "msg_arch_1",
          sessionID: "ses_1",
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5" },
        }
        await hooks["chat.message"]?.(
          { sessionID: "ses_1", messageID: "msg_arch_1" },
          {
            message: userMessage,
            parts: [
              {
                id: "part_1",
                sessionID: "ses_1",
                messageID: "msg_arch_1",
                type: "text",
                text: "Design a multi-region distributed architecture for session state replication",
              },
            ],
          },
        )
        const paramsOut = {
          temperature: 0,
          topP: 1,
          topK: 0,
          maxOutputTokens: 4096,
          options: {} as Record<string, unknown>,
        }
        await hooks["chat.params"]?.(
          {
            sessionID: "ses_1",
            agent: "build",
            model: {} as never,
            provider: {} as never,
            message: userMessage,
          },
          paramsOut,
        )
        expect(paramsOut.options.localQwenTriage).toEqual({
          complexity: "high",
          intent: "architecture",
        })

        // 5. Permission Risk Assist & Readonly Guard (permission.ask)
        await writeLocalQwenState(
          {
            ...(await readLocalQwenState(dirs)),
            features: {
              permissionAssist: true,
              autoAllowReadonly: true,
            },
          },
          dirs,
        )
        const safePerm: Permission = {
          id: "perm_1",
          type: "bash",
          pattern: "git status -sb",
          sessionID: "ses_1",
          messageID: "msg_1",
          title: "Run git status",
          metadata: {},
          time: { created: Date.now() },
        }
        const safePermOut: { status: "ask" | "deny" | "allow" } = { status: "ask" }
        await hooks["permission.ask"]?.(safePerm, safePermOut)
        expect(safePermOut.status).toBe("allow")
        expect(safePerm.metadata.localQwenRisk).toEqual({
          risk: "safe_readonly",
          reason: "Lists git status only",
        })

        const dangerousPerm: Permission = {
          id: "perm_2",
          type: "bash",
          pattern: "rm -rf ./dist",
          sessionID: "ses_1",
          messageID: "msg_1",
          title: "Remove dist",
          metadata: {},
          time: { created: Date.now() },
        }
        const dangerousPermOut: { status: "ask" | "deny" | "allow" } = { status: "ask" }
        await hooks["permission.ask"]?.(dangerousPerm, dangerousPermOut)
        expect(dangerousPermOut.status).toBe("ask")
        expect(dangerousPerm.metadata.localQwenRisk).toEqual({
          risk: "destructive",
          reason: "Deletes files recursively",
        })

        // 6. Command execution & removal (/local-qwen status & /local-qwen remove)
        const cmdOut = { parts: [] as Array<{ id: string; type: string; text?: string }> }
        await hooks["command.execute.before"]?.(
          { command: "local-qwen", sessionID: "ses_1", arguments: "status" },
          cmdOut as never,
        )
        expect(cmdOut.parts[0]?.text).toContain("Local Qwen 0.8B Edge Accelerator Status")
        expect(() => PartID.make(cmdOut.parts[0]!.id)).not.toThrow()

        const chatSlashParts: Array<{ id: string; sessionID: string; messageID: string; type: string; text?: string }> = [
          {
            id: PartID.ascending(),
            sessionID: "ses_1",
            messageID: "msg_slash_1",
            type: "text",
            text: "/local-qwen status",
          },
        ]
        await hooks["chat.message"]?.(
          { sessionID: "ses_1", messageID: "msg_slash_1" },
          {
            message: userMessage,
            parts: chatSlashParts as never,
          },
        )
        expect(chatSlashParts[1]?.text).toContain("Local Qwen 0.8B Edge Accelerator Status")
        expect(() => PartID.make(chatSlashParts[1]!.id)).not.toThrow()

        await runLocalQwenCommand("remove", dirs)
        expect(await isLocalQwenModelDownloaded(dirs)).toBe(false)
        expect((await readLocalQwenState(dirs)).enabled).toBe(false)

        // 7. Fast remove/re-install stash lifecycle for >= 1MB weights
        const largeWeights = new Uint8Array(1_100_000)
        largeWeights.fill(7)
        const modelPath = path.join(dirs.cacheDir, "qwen3-0.6b-q8_0.gguf")
        await fs.mkdir(dirs.cacheDir, { recursive: true })
        await fs.writeFile(modelPath, largeWeights)
        expect(await isLocalQwenModelDownloaded(dirs)).toBe(true)

        const removeReport = await runLocalQwenCommand("remove", dirs)
        expect(removeReport).toContain("Local Qwen 0.8B model weights removed and auto-takeover disabled.")
        expect(await isLocalQwenModelDownloaded(dirs)).toBe(false)
        expect((await readLocalQwenState(dirs)).enabled).toBe(false)

        const reinstallReport = await runLocalQwenCommand("install", { ...dirs, endpoint: endpointUrl })
        expect(reinstallReport).toContain("### Local Qwen 0.8B Installed & Enabled")
        expect(await isLocalQwenModelDownloaded(dirs)).toBe(true)
        expect((await readLocalQwenState(dirs)).enabled).toBe(true)

        await runLocalQwenCommand("remove --purge", dirs)
        expect(await isLocalQwenModelDownloaded(dirs)).toBe(false)
      } finally {
        server.stop(true)
      }
    })
  })
})
