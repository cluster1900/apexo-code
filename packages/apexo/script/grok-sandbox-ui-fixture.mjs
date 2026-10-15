import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

// Real native Session creation and ordinary text prompts. No synthetic rows or provider work from UI polling.
export async function startSandboxUiFixture() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const calls = []
  const runtime = await startShellFixture("cli", {
    next(input) {
      calls.push(input)
      return { content: "SANDBOX_UI_REPLY" }
    },
  })
  await runtime.crash()
  await writeFile(
    join(runtime.directory, "apexo.json"),
    JSON.stringify({
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        xai: {
          api: {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: runtime.env.XAI_BASE_URL,
            settings: { apiKey: "fixture" },
          },
          models: {
            "grok-4.7": {
              name: "fixture",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              limit: { context: 100000, output: 4096 },
            },
          },
        },
      },
    }),
  )
  const requests = join(runtime.output, "sandbox-http.jsonl")
  const outage = join(runtime.output, "sandbox-outage")
  const createOutage = join(runtime.output, "sandbox-create-outage")
  const serverFile = join(runtime.output, "native-server.mjs")
  await writeFile(
    serverFile,
    `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};import {appendFileSync,existsSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const url=new URL(req.url);const body=req.method==="POST"?await req.clone().text():undefined;const response=req.method==="POST"&&url.pathname==="/api/session"&&existsSync(${JSON.stringify(createOutage)})?Response.json({_tag:"ServiceUnavailableError",message:"Command sandbox is unavailable on this fixture backend."},{status:503,headers:{"Access-Control-Allow-Origin":"*"}}):url.pathname.endsWith("/sandbox")&&existsSync(${JSON.stringify(outage)})?Response.json({message:"private fixture conflict cause"},{status:409,headers:{"Access-Control-Allow-Origin":"*"}}):await app.handler(req);appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,body,path:url.pathname,query:url.search,status:response.status,contentLength:req.headers.get("content-length")})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const state = { child: undefined, exited: undefined }
  const logs = []
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
    await poll(() => runtime.url !== old, "native sandbox UI server ready", 30000)
  }
  runtime.api = async (path, body, method = body ? "POST" : "GET") => {
    const url = new URL(path, runtime.url)
    url.searchParams.set("location[directory]", runtime.directory)
    const response = await fetch(url, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    assert.ok(response.ok, `${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }
  const close = async () => {
    state.child?.kill("SIGTERM")
    if (state.exited)
      await deadline(state.exited, 10000, "Sandbox UI server cleanup").catch(async () => {
        state.child.kill("SIGKILL")
        await state.exited
      })
    await writeFile(join(runtime.output, "native-server.log"), Buffer.concat(logs))
    await runtime.close()
  }
  try {
    await start()
    assert.equal((await fetch(`${runtime.url}/global/health`)).status, 404)
    const session = (
      await runtime.api("/api/session", {
        location: { directory: runtime.directory },
        model: { providerID: "xai", id: "grok-4.7" },
        agent: "build",
      })
    ).data
    return {
      runtime,
      repo,
      calls,
      session,
      outage,
      createOutage,
      close,
      records: async () => (await readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
    }
  } catch (error) {
    await close()
    throw error
  }
}
