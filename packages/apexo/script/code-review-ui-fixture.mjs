import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startCodeReviewFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const hold = Promise.withResolvers()
  const calls = []
  const runtime = await startShellFixture("cli", {
    git: true,
    deferBackend: true,
    async next({ body, text }) {
      calls.push(body)
      if (text.includes("REVIEW_HOLD")) await hold.promise
      return {
        content: JSON.stringify({
          summary: "REVIEW_UI_REPORT",
          assessment: "issues_found",
          findings: [
            {
              priority: "P1",
              title: "Validate zero divisor",
              explanation: "A zero divisor returns Infinity to the caller.",
              confidence: 0.95,
              path: "calc.ts",
              side: "new",
              startLine: 2,
              endLine: 2,
            },
            {
              priority: "P2",
              title: "Captured context",
              explanation: "Outside-hunk evidence remains tied to the captured file.",
              confidence: 0.8,
              path: "calc.ts",
              side: "old",
              startLine: options.longEvidence ? 8 : 28,
              endLine: options.longEvidence ? 30 : 28,
            },
            {
              priority: "P3",
              title: "File-level evidence",
              explanation: "An invalid location must not highlight a fabricated line.",
              confidence: 0.7,
              path: "calc.ts",
              side: "new",
              startLine: 9999,
              endLine: 9999,
            },
          ],
        }),
      }
    },
  })
  const git = (...args) => {
    const result = Bun.spawnSync(
      [
        "git",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        ...args,
      ],
      { cwd: runtime.directory },
    )
    assert.equal(result.exitCode, 0, result.stderr.toString())
  }
  await writeFile(
    join(runtime.directory, "calc.ts"),
    "export function calc(a, b) {\n  return b === 0 ? 0 : a / b\n}\n" +
      Array.from({ length: 30 }, (_, i) => `// captured context ${i}`).join("\n") +
      "\n",
  )
  if (options.large) {
    await mkdir(join(runtime.directory, "many-files"), { recursive: true })
    await Promise.all(
      Array.from({ length: 6279 }, (_, index) =>
        writeFile(join(runtime.directory, "many-files", `${index}.ts`), `export const value = ${index}\n`),
      ),
    )
    git("add", "many-files")
  }
  git("add", "calc.ts")
  git("commit", "-qm", "review baseline")
  await writeFile(
    join(runtime.directory, "calc.ts"),
    "export function calc(a, b) {\n  return a / b\n}\n" +
      Array.from({ length: 30 }, (_, i) => `// captured context ${i}`).join("\n") +
      "\n",
  )
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      model: "reviewfixture/review-model",
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        reviewfixture: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: runtime.env.XAI_BASE_URL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "review-model": {
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  if (options.mixed || options.desktop) {
    await writeFile(
      join(runtime.directory, "apexo.json"),
      JSON.stringify({
        model: "reviewfixture/review-model",
        snapshot: false,
        permission: { "*": "allow" },
        lsp: false,
        provider: {
          reviewfixture: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: runtime.env.XAI_BASE_URL, apiKey: "fixture" },
            models: {
              "review-model": {
                name: "fixture",
                tool_call: true,
                limit: { context: 100000, output: 4096 },
                provider: { npm: "@ai-sdk/openai-compatible", api: runtime.env.XAI_BASE_URL },
              },
            },
          },
        },
      }),
    )
  }
  runtime.env.APEXO_CONFIG_CONTENT = await Bun.file(join(runtime.directory, "apexo.json")).text()
  if (options.github) {
    runtime.env.GH_CONFIG_DIR = process.env.GH_CONFIG_DIR ?? join(process.env.HOME, ".config/gh")
  }
  const serverFile = join(runtime.output, "native-server.mjs")
  const requests = []
  await writeFile(
    serverFile,
    options.mixed
      ? `import {Server} from ${JSON.stringify(join(repo, "packages/apexo/src/server/server.ts"))};const server=await Server.listen({hostname:"127.0.0.1",port:0});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);process.exit(0)});`
      : `import {existsSync,writeFileSync} from "node:fs";import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,fetch:async(request)=>{if(request.method==="GET"&&new URL(request.url).pathname.endsWith("/review")&&existsSync(${JSON.stringify(join(runtime.output, "hold-list"))})){writeFileSync(${JSON.stringify(join(runtime.output, "list-held"))},"held");while(existsSync(${JSON.stringify(join(runtime.output, "hold-list"))}))await Bun.sleep(10)}return app.handler(request)}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const logs = []
  const state = { child: undefined, exited: undefined }
  const start = async () => {
    const old = runtime.url
    state.child = spawn(process.execPath, [serverFile], {
      cwd: runtime.directory,
      env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.exited = new Promise((resolve) => state.child.once("exit", resolve))
    state.child.stdout.on("data", (chunk) => {
      logs.push(chunk)
      const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
      if (match) runtime.url = match[1]
    })
    state.child.stderr.on("data", (chunk) => logs.push(chunk))
    await poll(() => runtime.url !== old, "native review server ready", 30000)
  }
  if (!options.desktop) await start()
  runtime.api = async (path, body, method = body ? "POST" : "GET") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    if (!url.pathname.startsWith("/api/")) url.searchParams.set("directory", runtime.directory)
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(45000),
      headers: runtime.headers,
      ...(body
        ? { headers: { "content-type": "application/json", ...runtime.headers }, body: JSON.stringify(body) }
        : {}),
    })
    const text = await response.text()
    requests.push({ method, path: url.pathname, status: response.status })
    assert.ok(response.ok, `${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const session = options.desktop
    ? undefined
    : (
        await runtime.api("/api/session", {
          location: { directory: runtime.directory },
          model: { providerID: "reviewfixture", id: "review-model" },
          agent: "build",
        })
      ).data
  return {
    runtime,
    repo,
    session,
    calls,
    hold,
    requests,
    async pauseRefresh() {
      await writeFile(join(runtime.output, "hold-list"), "hold")
      await poll(() => Bun.file(join(runtime.output, "list-held")).exists(), "passive list request held")
      return () => Bun.file(join(runtime.output, "hold-list")).delete()
    },
    async peer() {
      const peer = spawn(process.execPath, [serverFile], {
        cwd: runtime.directory,
        env: { ...runtime.env, APEXO_SERVER_PASSWORD: "" },
        stdio: ["ignore", "pipe", "pipe"],
      })
      const exited = new Promise((resolve) => peer.once("exit", resolve))
      const output = { text: "" }
      peer.stdout.on("data", (chunk) => {
        output.text += chunk.toString()
      })
      peer.stderr.on("data", (chunk) => logs.push(chunk))
      const url = await poll(
        () => output.text.match(/NATIVE_URL=(http:\/\/[^\s]+)/)?.[1],
        "peer review host ready",
        30000,
      )
      return {
        url,
        async close() {
          peer.kill("SIGTERM")
          await deadline(exited, 10000, "peer cleanup").catch(() => peer.kill("SIGKILL"))
        },
      }
    },
    async close() {
      hold.resolve()
      await Bun.file(join(runtime.output, "hold-list"))
        .delete()
        .catch(() => {})
      state.child?.kill("SIGTERM")
      if (state.exited)
        await deadline(state.exited, 15000, "native review cleanup").catch(() => state.child.kill("SIGKILL"))
      await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
      await runtime.close()
    },
  }
}
