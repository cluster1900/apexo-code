// Real native media UI fixture; repository MP4 is a labeled local provider response, not generated service evidence.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { startShellFixture, poll, deadline } from "./grok-shell-fixture.mjs"

export async function startMediaUiFixture(options = {}) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
  const mp4 = await readFile(join(repo, "packages/app/src/assets/help/introducing-tabs.mp4"))
  const media = []
  const sessions = []
  const inputs = {
    image_gen: { prompt: "blue square" },
    image_edit: { prompt: "red square", image: ["[Image #1]"] },
    image_to_video: { prompt: "rotate", image: `data:image/png;base64,${png}`, duration: 6 },
    reference_to_video: {
      prompt: "wave",
      first_frame: `data:image/png;base64,${png}`,
      voices: ["eve"],
      keyframes: [{ image: `data:image/png;base64,${png}`, timestamp_s: 2.1 }],
      aspect_ratio: "16:9",
      duration: 6,
    },
  }
  const fixture = await startShellFixture("cli", {
    async http(request, response) {
      if (!/\/(images|videos)\//.test(request.url) && request.url !== "/native-media.mp4") return false
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      media.push({
        path: request.url,
        authorization: request.headers.authorization,
        privateHeader: request.headers["x-media-private"],
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined,
      })
      if (request.url === "/native-media.mp4") {
        response.end(mp4)
        return true
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify(
          request.url.includes("/images/")
            ? { data: [{ b64_json: png }] }
            : request.method === "POST"
              ? { request_id: "native-media" }
              : { status: "done", video: { url: `http://${request.headers.host}/native-media.mp4` } },
        ),
      )
      return true
    },
    next({ text, finished, ancillary }) {
      const name = Object.keys(inputs).find((name) => text.includes(`NATIVE_MEDIA_${name}`))
      if (finished || ancillary || !name) return { content: "NATIVE_MEDIA_DONE" }
      return { tool: name, args: inputs[name] }
    },
  })
  await fixture.crash()
  const requests = join(fixture.output, "media-http.jsonl")
  const serverFile = join(fixture.output, "native-media-server.mjs")
  await writeFile(
    serverFile,
    `${options.mixed ? `import {HttpApiApp} from ${JSON.stringify(join(repo, "packages/apexo/src/server/routes/instance/httpapi/server.ts"))};const webHandler=HttpApiApp.webHandler;` : `import {webHandler} from ${JSON.stringify(join(repo, "packages/server/src/routes.ts"))};`}import {appendFileSync} from "node:fs";const app=webHandler();const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:async(req)=>{const url=new URL(req.url);const response=await app.handler(req${options.mixed ? ",HttpApiApp.context" : ""});appendFileSync(${JSON.stringify(requests)},JSON.stringify({method:req.method,path:url.pathname,query:url.search,status:response.status})+"\\n");return response}});console.log("NATIVE_URL="+server.url.origin);process.on("SIGTERM",async()=>{await server.stop(true);await app.dispose();process.exit(0)});`,
  )
  const logs = []
  const old = fixture.url
  const child = spawn(process.execPath, [serverFile], {
    cwd: fixture.directory,
    env: { ...fixture.env, APEXO_SERVER_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.stdout.on("data", (chunk) => {
    logs.push(chunk)
    const match = chunk.toString().match(/NATIVE_URL=(http:\/\/[^\s]+)/)
    if (match) fixture.url = match[1]
  })
  child.stderr.on("data", (chunk) => logs.push(chunk))
  const close = async () => {
    child.kill("SIGTERM")
    await deadline(exited, 10000, "native media cleanup").catch(async () => {
      child.kill("SIGKILL")
      await exited
    })
    await writeFile(join(fixture.output, "native-server.log"), Buffer.concat(logs))
    await fixture.close()
  }
  try {
    await poll(() => fixture.url !== old, "native media server", 30000)
    fixture.api = async (path, body, method = body ? "POST" : "GET") => {
      const url = new URL(path, fixture.url)
      url.searchParams.set("location[directory]", fixture.directory)
      const response = await fetch(url, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      })
      const text = await response.text()
      assert.ok(response.ok, `${response.status}: ${text}`)
      return text ? JSON.parse(text) : undefined
    }
    const legacy = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
    await writeFile(
      join(fixture.directory, "apexo.json"),
      JSON.stringify(
        options.mixed
          ? legacy
          : {
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
              providers: {
                xai: {
                  api: {
                    type: "aisdk",
                    package: "@ai-sdk/xai",
                    url: legacy.provider.xai.options.baseURL,
                    settings: { apiKey: "fixture" },
                  },
                  request: { body: { apiKey: "fixture" }, headers: { "x-media-private": "provider-only" } },
                  models: {
                    "grok-4.7": {
                      name: "Fixture",
                      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                      limit: { context: 100000, output: 4096 },
                    },
                  },
                },
              },
            },
      ),
    )
    for (const name of [...Object.keys(inputs), "image_to_video"]) {
      const session = (
        await fixture.api("/api/session", {
          location: { directory: fixture.directory },
          model: { providerID: "xai", id: "grok-4.7" },
        })
      ).data
      await fixture.api(`/api/session/${session.id}/prompt`, {
        prompt: { text: `NATIVE_MEDIA_${name}`, files: [{ mime: "image/png", uri: `data:image/png;base64,${png}` }] },
      })
      const messages = await poll(
        async () => {
          const url = new URL(`/api/session/${session.id}/message`, fixture.url)
          url.searchParams.set("order", "asc")
          url.searchParams.set("directory", fixture.directory)
          const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
          assert.ok(response.ok, await response.clone().text())
          const data = (await response.json()).data
          return data.some(
            (message) =>
              message.type === "assistant" &&
              message.content.some((part) => part.type === "text" && part.text === "NATIVE_MEDIA_DONE"),
          )
            ? data
            : undefined
        },
        `native ${name} completion`,
        20000,
      )
      const tool = messages
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.name === name)
      assert.equal(tool?.state.status, "completed", JSON.stringify(tool))
      const video = name.endsWith("video")
      assert.equal(tool.state.structured.mime, video ? "video/mp4" : "image/png")
      assert.deepEqual(await readFile(tool.state.structured.path), video ? mp4 : Buffer.from(png, "base64"))
      assert.equal(
        tool.state.content.some((part) => part.type === "file"),
        !video,
      )
      sessions.push({ ...session, name, path: tool.state.structured.path, toolID: tool.id })
    }
    assert.equal(fixture.calls.filter((call) => !call.ancillary).length, 10)
    return {
      runtime: fixture,
      repo,
      sessions,
      media,
      close,
      records: async () =>
        (await readFile(requests, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
    }
  } catch (error) {
    await close()
    throw error
  }
}
