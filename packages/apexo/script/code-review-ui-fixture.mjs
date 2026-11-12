import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startCodeReviewFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const hold = Promise.withResolvers()
  const calls = []
  const runtime = await startShellFixture("cli", {
    git: true,
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
              startLine: 28,
              endLine: 28,
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
  await runtime.crash()
  const git = (...args) => {
    const result = Bun.spawnSync(
      ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
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
  runtime.env.APEXO_CONFIG_CONTENT = await Bun.file(join(runtime.directory, "apexo.json")).text()
  if (options.github) {
    runtime.env.GH_CONFIG_DIR = process.env.GH_CONFIG_DIR ?? join(process.env.HOME, ".config/gh")
  }
  const serverFile = join(runtime.output, "native-server.mjs")
  const requests = []
  await writeFile(
    serverFile,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:0,fetch:app.handler});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
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
  await start()
  runtime.api = async (path, body, method = body ? "POST" : "GET") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    const response = await fetch(url, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    requests.push({ method, path: url.pathname, status: response.status })
    assert.ok(response.ok, `${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const session = (
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
    async close() {
      hold.resolve()
      state.child?.kill("SIGTERM")
      if (state.exited)
        await deadline(state.exited, 15000, "native review cleanup").catch(() => state.child.kill("SIGKILL"))
      await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
      await runtime.close()
    },
  }
}
