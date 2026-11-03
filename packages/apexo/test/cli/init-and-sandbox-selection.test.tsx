/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { ApexoKeymapProvider } from "@apexo/tui/keymap"
import { CommandSandboxBrowser, type CommandSandboxActions } from "@apexo/tui/component/command-sandbox-browser"
import { OpenAIChat } from "@apexo/llm/protocols/openai-chat"
import { OpenAIResponses } from "@apexo/llm/protocols/openai-responses"
import { Gemini } from "@apexo/llm/protocols/gemini"
import { LLMRequest, Model, Message, SystemPart, ToolDefinition } from "@apexo/llm"
import { CommandSandboxPaths } from "@apexo/core/command-sandbox/paths"
import { createApexoClient } from "@apexo/sdk/v2/client"
import { createNativeLocalHost } from "@/cli/native-local-host"
import { runNativeHeadless } from "@/cli/native-headless"
import { runNativeLocalMini } from "@/cli/native-local"
import { loadOutputSchema } from "@/cli/run-output-options"
import { InitCommand, type InitReport } from "@/cli/cmd/init"

async function runInit(args: {
  dir: string
  force?: boolean
  agentsOnly?: boolean
  sandboxOnly?: boolean
}): Promise<InitReport> {
  const chunks: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
    return true
  }) as typeof process.stdout.write
  try {
    await InitCommand.handler?.({
      $0: "apexo",
      _: ["init"],
      dir: args.dir,
      force: args.force ?? false,
      "agents-only": args.agentsOnly ?? false,
      agentsOnly: args.agentsOnly ?? false,
      "sandbox-only": args.sandboxOnly ?? false,
      sandboxOnly: args.sandboxOnly ?? false,
      json: true,
    } as Parameters<NonNullable<typeof InitCommand.handler>>[0])
  } finally {
    process.stdout.write = origWrite
  }
  return JSON.parse(chunks.join("")) as InitReport
}

describe("V2 native structured output lowering (@apexo/llm protocols)", () => {
  const sampleSchema = {
    type: "object",
    properties: {
      approved: { type: "boolean" },
      summary: { type: "string" },
    },
    required: ["approved", "summary"],
    additionalProperties: false,
  }

  function makeRequest() {
    return new LLMRequest({
      model: Model.make({
        id: "test-model",
        provider: "test-provider",
        route: OpenAIResponses.route,
      }),
      system: SystemPart.content("Return JSON."),
      messages: [Message.user("Analyze status")],
      tools: [],
      responseFormat: {
        type: "json",
        schema: sampleSchema,
      },
    })
  }

  test("lowers responseFormat.schema to OpenAI Chat response_format json_schema", async () => {
    const body = await Effect.runPromise(OpenAIChat.protocol.body.from(makeRequest()))
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "structured_output",
        schema: sampleSchema,
      },
    })
  })

  test("lowers responseFormat.schema to OpenAI Responses text.format json_schema", async () => {
    const body = await Effect.runPromise(OpenAIResponses.protocol.body.from(makeRequest()))
    expect(body.text?.format).toEqual({
      type: "json_schema",
      name: "structured_output",
      schema: sampleSchema,
    })
  })

  test("lowers responseFormat.schema to Gemini generationConfig responseMimeType and responseSchema even when tools are enabled", async () => {
    const req = new LLMRequest({
      ...makeRequest(),
      tools: [
        new ToolDefinition({
          name: "read",
          description: "Read a file",
          inputSchema: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] },
        }),
      ],
    })
    const body = await Effect.runPromise(Gemini.protocol.body.from(req))
    expect(body.tools).toHaveLength(1)
    expect(body.generationConfig?.responseMimeType).toBe("application/json")
    expect(body.generationConfig?.responseSchema).toEqual({
      type: "object",
      properties: {
        approved: { type: "boolean" },
        summary: { type: "string" },
      },
      required: ["approved", "summary"],
    })
  })
})

describe("apexo init workspace scaffolding and native sandbox integration", () => {
  test("detects Bun/TS, Python, Rust, and Go stacks and scaffolds valid AGENTS.md + .apexo/sandbox.toml", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "apexo-init-test-"))
    try {
      const bunDir = path.join(root, "bun-proj")
      await Bun.write(
        path.join(bunDir, "package.json"),
        JSON.stringify({
          name: "acme-web",
          scripts: {
            build: "bun run build.ts",
            test: "bun test",
            typecheck: "tsgo --noEmit",
            lint: "biome check .",
          },
        }),
      )
      await Bun.write(path.join(bunDir, "bun.lock"), "")
      await Bun.write(path.join(bunDir, "tsconfig.json"), "{}")

      const first = await runInit({ dir: bunDir })
      expect(first.detected.projectName).toBe("acme-web")
      expect(first.detected.stacks).toEqual(["javascript"])
      expect(first.detected.packageManager).toBe("bun")
      expect(first.detected.commands).toEqual({
        install: "bun install",
        build: "bun run build",
        test: "bun run test",
        typecheck: "bun run typecheck",
        lint: "bun run lint",
      })
      expect(first.files.map((f) => ({ kind: f.kind, status: f.status }))).toEqual([
        { kind: "agents", status: "created" },
        { kind: "sandbox", status: "created" },
      ])

      const agentsMd = await Bun.file(path.join(bunDir, "AGENTS.md")).text()
      expect(agentsMd).toContain("# acme-web — Agent Guidelines")
      expect(agentsMd).toContain("`bun run typecheck`")
      expect(agentsMd).toContain("`--sandbox pkg-install`")
      expect(agentsMd).toContain("`--sandbox ci-verify`")
      expect(agentsMd).toContain("--session-protocol native")
      expect(agentsMd).toContain("When a non-`off` command sandbox profile is enabled")
      expect(agentsMd).toContain("run `/new` to start a new Session with that profile")

      const sandboxToml = await Bun.file(path.join(bunDir, ".apexo", "sandbox.toml")).text()
      expect(sandboxToml).toContain("[filesystem]")
      expect(sandboxToml).toContain('deny = [".env", ".env.*", "**/.env", "**/.env.*"]')
      expect(sandboxToml).toContain("[profiles.pkg-install]")
      expect(sandboxToml).toContain('allow_domains = ["registry.npmjs.org", "*.npmjs.org"]')
      expect(sandboxToml).toContain("[profiles.ci-verify]")

      // Verify generated .apexo/sandbox.toml blocks .env both at root and in subdirectories
      await Bun.write(path.join(bunDir, ".env"), "ROOT=1\n")
      await Bun.write(path.join(bunDir, "packages", "sub", ".env"), "SUB=2\n")
      await Bun.write(path.join(bunDir, "packages", "sub", ".env.local"), "LOCAL=3\n")
      const resolvedPolicy = await Effect.runPromise(
        CommandSandboxPaths.resolve({
          workspace: bunDir,
          profile: "pkg-install",
          protected: [],
        }),
      )
      if (!("workspace" in resolvedPolicy)) throw new Error("Expected confined policy")
      for (const rel of [".env", "packages/sub/.env", "packages/sub/.env.local"]) {
        const target = await CommandSandboxPaths.resolveTarget(rel, bunDir)
        expect(CommandSandboxPaths.canRead(resolvedPolicy, target.lexical, target.canonical)).toBe(false)
      }

      // Verify unknown profile error lists available profiles including custom ones
      await expect(
        Effect.runPromise(
          CommandSandboxPaths.resolve({
            workspace: bunDir,
            profile: "nope",
            protected: [],
          }),
        ),
      ).rejects.toThrow("Unknown command sandbox profile: nope. Available profiles: off, workspace, read-only, strict, devbox, pkg-install, ci-verify")

      // Running again without --force skips existing files
      await Bun.write(path.join(bunDir, "AGENTS.md"), "# custom\n")
      const second = await runInit({ dir: bunDir })
      expect(second.files.map((f) => f.status)).toEqual(["skipped", "skipped"])
      expect(await Bun.file(path.join(bunDir, "AGENTS.md")).text()).toBe("# custom\n")

      // Running with --force overwrites
      const third = await runInit({ dir: bunDir, force: true })
      expect(third.files.map((f) => f.status)).toEqual(["overwritten", "overwritten"])
      expect(await Bun.file(path.join(bunDir, "AGENTS.md")).text()).toContain("# acme-web — Agent Guidelines")

      // Multi-language detection (Python + Rust + Go)
      const polyDir = path.join(root, "poly-proj")
      await Bun.write(path.join(polyDir, "pyproject.toml"), '[project]\nname = "poly"\n')
      await Bun.write(path.join(polyDir, "uv.lock"), "")
      await Bun.write(path.join(polyDir, "Cargo.toml"), '[package]\nname = "poly-rs"\n')
      await Bun.write(path.join(polyDir, "go.mod"), "module example.com/poly\n")
      const poly = await runInit({ dir: polyDir, sandboxOnly: true })
      expect(poly.detected.stacks).toEqual(["rust", "python", "go"])
      expect(poly.files.map((f) => f.kind)).toEqual(["sandbox"])
      expect(poly.detected.allowDomains).toContain("pypi.org")
      expect(poly.detected.allowDomains).toContain("crates.io")
      expect(poly.detected.allowDomains).toContain("proxy.golang.org")

      // Python project with only pyproject.toml (no requirements.txt, no pytest/ruff config) uses `pip install -e .` and does not invent pytest/ruff commands
      const pyOnlyDir = path.join(root, "py-only")
      await Bun.write(path.join(pyOnlyDir, "pyproject.toml"), '[project]\nname = "py-only"\n')
      const pyOnly = await runInit({ dir: pyOnlyDir, agentsOnly: true })
      expect(pyOnly.detected.commands.install).toBe("pip install -e .")
      expect(pyOnly.detected.commands.test).toBeUndefined()
      expect(pyOnly.detected.commands.lint).toBeUndefined()
      const pyAgents = await Bun.file(path.join(pyOnlyDir, "AGENTS.md")).text()
      expect(pyAgents).toContain("`pip install -e .`")
      expect(pyAgents).not.toContain("requirements.txt")
      expect(pyAgents).not.toContain("ruff check")
      expect(pyAgents).toContain("Add the project's test command here")

      // Python project with requirements.txt containing pytest and ruff.toml configures both
      const pyReqDir = path.join(root, "py-req")
      await Bun.write(path.join(pyReqDir, "requirements.txt"), "pytest\n")
      await Bun.write(path.join(pyReqDir, "ruff.toml"), "line-length = 100\n")
      const pyReq = await runInit({ dir: pyReqDir, agentsOnly: true })
      expect(pyReq.detected.commands.install).toBe("pip install -r requirements.txt")
      expect(pyReq.detected.commands.test).toBe("pytest")
      expect(pyReq.detected.commands.lint).toBe("ruff check .")

      // Existing `Agents.md` (mixed case on case-insensitive filesystems) reports actual on-disk filename
      const caseDir = path.join(root, "case-proj")
      await Bun.write(path.join(caseDir, "Agents.md"), "# Old Agents\n")
      const caseSkipped = await runInit({ dir: caseDir, agentsOnly: true })
      expect(caseSkipped.files[0]?.relativePath).toBe("Agents.md")
      expect(caseSkipped.files[0]?.status).toBe("skipped")
      const caseOverwritten = await runInit({ dir: caseDir, agentsOnly: true, force: true })
      expect(caseOverwritten.files[0]?.relativePath).toBe("Agents.md")
      expect(caseOverwritten.files[0]?.status).toBe("overwritten")

      // Symlinked `AGENTS.md -> ../shared/shared.md` preserves symlink target and reports `AGENTS.md` without touching local `shared.md`
      const sharedDir = path.join(root, "shared-docs")
      const linkProjDir = path.join(root, "link-proj")
      await Bun.write(path.join(sharedDir, "shared.md"), "# Shared original\n")
      await Bun.write(path.join(linkProjDir, "shared.md"), "# Do not overwrite local shared.md\n")
      await symlink(path.join(sharedDir, "shared.md"), path.join(linkProjDir, "AGENTS.md"))
      const linkOverwritten = await runInit({ dir: linkProjDir, agentsOnly: true, force: true })
      expect(linkOverwritten.files[0]?.relativePath).toBe("AGENTS.md")
      expect(linkOverwritten.files[0]?.status).toBe("overwritten")
      expect(await Bun.file(path.join(sharedDir, "shared.md")).text()).toContain("# link-proj — Agent Guidelines")
      expect(await Bun.file(path.join(linkProjDir, "shared.md")).text()).toBe("# Do not overwrite local shared.md\n")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("native headless execution lowers outputSchema to provider wire request and seals --sandbox profile", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "apexo-native-schema-sb-"))
    const captured: Array<{ path: string; body: Record<string, unknown> }> = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        const body = (await req.json()) as Record<string, unknown>
        captured.push({ path: url.pathname, body })
        const payload = JSON.stringify({ status: "verified", issues: 0 })
        if (url.pathname.endsWith("/responses")) {
          const sse = [
            `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp_1", model: "responses-model" } })}\n\n`,
            `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { id: "msg_1", type: "message", role: "assistant" } })}\n\n`,
            `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: payload })}\n\n`,
            `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { id: "msg_1", type: "message", role: "assistant" } })}\n\n`,
            `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 } } })}\n\n`,
          ].join("")
          return new Response(sse, { headers: { "content-type": "text/event-stream" } })
        }
        const sse = [
          `data: ${JSON.stringify({ id: "chat_1", choices: [{ index: 0, delta: { role: "assistant", content: payload }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id: "chat_1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 } })}\n\n`,
          `data: [DONE]\n\n`,
        ].join("")
        return new Response(sse, { headers: { "content-type": "text/event-stream" } })
      },
    })

    const prevCwd = process.cwd()
    const host = createNativeLocalHost(undefined, true)
    try {
      await Bun.write(path.join(dir, "package.json"), JSON.stringify({ name: "sb-test" }))
      await runInit({ dir })

      await Bun.write(
        path.join(dir, "apexo.json"),
        JSON.stringify({
          providers: {
            "test-chat": {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai-compatible",
                url: `http://127.0.0.1:${server.port}/v1`,
                settings: { apiKey: "test-key" },
              },
              models: {
                "chat-model": {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
            "test-responses": {
              api: {
                type: "aisdk",
                package: "@ai-sdk/openai",
                url: `http://127.0.0.1:${server.port}/v1`,
                settings: { apiKey: "test-key" },
              },
              models: {
                "responses-model": {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  limit: { context: 100000, output: 4096 },
                },
              },
            },
          },
        }),
      )

      const schemaPath = path.join(dir, "out.schema.json")
      const expectedSchema = {
        type: "object",
        properties: {
          status: { type: "string" },
          issues: { type: "number" },
        },
        required: ["status", "issues"],
        additionalProperties: false,
      }
      await Bun.write(schemaPath, JSON.stringify(expectedSchema))
      const outputSchema = await loadOutputSchema(schemaPath, dir)

      process.chdir(dir)
      const sdk = createApexoClient({ baseUrl: "http://apexo.local", fetch: host.fetch, directory: dir })

      // 1. Verify generated .apexo/sandbox.toml is loaded into V2 sandbox catalog
      const catalog = (await sdk.v2.sandbox.catalog({ location: { directory: dir } }, { throwOnError: true })).data
      const pkgInstall = catalog.profiles.find((p) => p.name === "pkg-install")
      expect(pkgInstall).toBeDefined()
      expect(pkgInstall?.allowDomains).toEqual(["*.npmjs.org", "registry.npmjs.org"])

      // 2. Run native headless with openai-chat + outputSchema + sandbox: pkg-install
      await runNativeHeadless({
        sdk,
        directory: dir,
        model: { providerID: "test-chat", modelID: "chat-model" },
        files: [],
        text: "Verify chat structured output",
        format: "json",
        outputSchema,
        sandbox: "pkg-install",
      })

      // 3. Run native headless with openai-responses + outputSchema + sandbox: ci-verify
      await runNativeHeadless({
        sdk,
        directory: dir,
        model: { providerID: "test-responses", modelID: "responses-model" },
        files: [],
        text: "Verify responses structured output",
        format: "json",
        outputSchema,
        sandbox: "ci-verify",
      })

      expect(captured).toHaveLength(2)
      expect(captured[0]?.body.response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: expectedSchema,
        },
      })
      expect((captured[1]?.body.text as { format?: unknown } | undefined)?.format).toEqual({
        type: "json_schema",
        name: "structured_output",
        schema: expectedSchema,
      })

      const sessions = (await sdk.v2.session.list({ directory: dir, order: "asc" }, { throwOnError: true })).data.data
      expect(sessions).toHaveLength(2)
      const sb0 = (await sdk.v2.session.sandbox({ sessionID: sessions[0]!.id }, { throwOnError: true })).data
      const sb1 = (await sdk.v2.session.sandbox({ sessionID: sessions[1]!.id }, { throwOnError: true })).data
      expect(sb0.profile).toBe("pkg-install")
      expect(sb0.allowDomains).toEqual(["*.npmjs.org", "registry.npmjs.org"])
      expect(sb1.profile).toBe("ci-verify")
      expect(sb1.network).toBe("off")

      // 4. Continuing an existing session with a mismatched --sandbox emits a clear warning to stderr
      const stderrChunks: string[] = []
      const origStderrWrite = process.stderr.write.bind(process.stderr)
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
        return true
      }) as typeof process.stderr.write
      try {
        await runNativeHeadless({
          sdk,
          directory: dir,
          session: sessions[0]!.id,
          model: { providerID: "test-chat", modelID: "chat-model" },
          files: [],
          text: "Continue existing session",
          format: "json",
          sandbox: "ci-verify",
        })
      } finally {
        process.stderr.write = origStderrWrite
      }
      expect(stderrChunks.join("")).toContain(
        `Warning: --sandbox ci-verify did not take effect because existing Session ${sessions[0]!.id} uses immutable sandbox profile "pkg-install"`,
      )
    } finally {
      process.chdir(prevCwd)
      await host.close()
      server.stop(true)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CommandSandboxBrowser interactive profile preselection", () => {
  test("cycles new Session sandbox profile with p and tab keys in native mode", async () => {
    let currentProfile = "off"
    const chosen: string[] = []
    const actions: CommandSandboxActions = {
      get: async () => undefined,
      catalog: async () => ({
        scope: "native_commands",
        backend: { kind: "seatbelt", availability: "available" },
        profiles: [
          { name: "off", builtin: true, network: "unrestricted", allowDomains: [] },
          { name: "workspace", builtin: true, base: "workspace", network: "off", allowDomains: [] },
          {
            name: "pkg-install",
            builtin: false,
            base: "workspace",
            network: "off",
            allowDomains: ["registry.npmjs.org"],
          },
          { name: "ci-verify", builtin: false, base: "read-only", network: "off", allowDomains: [] },
        ],
      }),
      native: () => true,
      selected: () => currentProfile,
      select: (next) => {
        currentProfile = next
        chosen.push(next)
      },
    }

    function Harness() {
      const keymap = createDefaultOpenTuiKeymap(useRenderer())
      return (
        <ApexoKeymapProvider keymap={keymap}>
          <CommandSandboxBrowser
            actions={actions}
            onClose={() => {}}
            height={20}
            theme={() => ({ text: "white", muted: "gray", error: "red", highlight: "cyan" })}
          />
        </ApexoKeymapProvider>
      )
    }

    const app = await testRender(() => <Harness />, { width: 110, height: 24 })
    try {
      await Bun.sleep(20)
      await app.renderOnce()
      await app.renderOnce()
      const initial = app.captureCharFrame()
      expect(initial).toContain("Command sandbox · r refresh · p/tab profile · esc back")
      expect(initial).toContain("New Session profile: off (press p or tab to cycle)")
      expect(initial).toContain("Available profiles: off, workspace, pkg-install (workspace), ci-verify (read-only)")

      app.mockInput.pressKey("p")
      await Bun.sleep(20)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("New Session profile: workspace")

      app.mockInput.pressTab()
      await Bun.sleep(20)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("New Session profile: pkg-install")

      app.mockInput.pressKey("p")
      await Bun.sleep(20)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("New Session profile: ci-verify")

      app.mockInput.pressKey("p")
      await Bun.sleep(20)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("New Session profile: off")

      expect(chosen).toEqual(["workspace", "pkg-install", "ci-verify", "off"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders full Available profiles list including ci-verify inside an 80x24 dialog with active session status", async () => {
    const actions: CommandSandboxActions = {
      get: async () => ({
        scope: "native_commands",
        stored: true,
        profile: "pkg-install",
        base: "workspace",
        network: "off",
        allowDomains: ["registry.npmjs.org", "*.npmjs.org"],
        backend: { kind: "seatbelt", availability: "available" },
      }),
      catalog: async () => ({
        scope: "native_commands",
        backend: { kind: "seatbelt", availability: "available" },
        profiles: [
          { name: "off", builtin: true, network: "unrestricted", allowDomains: [] },
          { name: "workspace", builtin: true, base: "workspace", network: "off", allowDomains: [] },
          { name: "read-only", builtin: true, base: "read-only", network: "off", allowDomains: [] },
          { name: "strict", builtin: true, base: "strict", network: "off", allowDomains: [] },
          { name: "devbox", builtin: true, base: "devbox", network: "unrestricted", allowDomains: [] },
          { name: "pkg-install", builtin: false, base: "workspace", network: "off", allowDomains: ["registry.npmjs.org"] },
          { name: "ci-verify", builtin: false, base: "read-only", network: "off", allowDomains: [] },
        ],
      }),
      native: () => true,
      selected: () => "pkg-install",
      select: () => {},
    }

    function DialogHarness() {
      const keymap = createDefaultOpenTuiKeymap(useRenderer())
      return (
        <ApexoKeymapProvider keymap={keymap}>
          <box width={80} height={24} paddingTop={6} alignItems="center">
            <box width={78} paddingTop={1}>
              <CommandSandboxBrowser
                actions={actions}
                onClose={() => {}}
                theme={() => ({ text: "white", muted: "gray", error: "red", highlight: "cyan" })}
              />
            </box>
          </box>
        </ApexoKeymapProvider>
      )
    }

    const app = await testRender(() => <DialogHarness />, { width: 80, height: 24 })
    try {
      await Bun.sleep(20)
      await app.renderOnce()
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Stored profile: pkg-install (extends workspace)")
      expect(frame).toContain("pkg-install")
      expect(frame).toContain("ci-verify (read-only)")
    } finally {
      app.renderer.destroy()
    }
  })

  test("runNativeLocalMini routes interactive: true with --sandbox to the interactive path instead of headless", async () => {
    const prevIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    try {
      await expect(
        runNativeLocalMini({
          interactive: true,
          sandbox: "workspace",
        }),
      ).rejects.toThrow("--mini requires a TTY stdout")
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: prevIsTTY, configurable: true })
    }
  })
})
