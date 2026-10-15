// Native media acceptance against a real CLI or packaged Desktop server; all providers are local fixtures.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom00000000")])
const media = []
const stored = new Map()
const checks = []
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
const fixture = await startShellFixture(process.argv[2] ?? "cli", {
  env: {
    GROK_IMAGE_GEN_MODEL_OVERRIDE: "environment-generation",
    GROK_IMAGE_EDIT_MODEL_OVERRIDE: "",
    APEXO_MEDIA_OPTIONS_RW_ID: "writer",
    APEXO_MEDIA_OPTIONS_RW_SECRET: "writer-secret",
    APEXO_MEDIA_OPTIONS_RO_ID: "reader",
    APEXO_MEDIA_OPTIONS_RO_SECRET: "reader-secret",
  },
  async http(request, response) {
    if (request.url.startsWith("/storage/")) {
      const url = new URL(request.url, "http://fixture")
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      media.push({
        path: url.pathname,
        method: request.method,
        credential: url.searchParams.get("X-Amz-Credential"),
        authorization: request.headers.authorization,
        privateHeader: request.headers["x-media-private"],
      })
      if (request.method === "PUT") stored.set(url.pathname, Buffer.concat(chunks))
      response.end(request.method === "PUT" ? undefined : stored.get(url.pathname))
      return true
    }
    if (!/\/(images|videos)\//.test(request.url)) return false
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
    if (request.method === "POST" && request.url.includes("/videos/")) {
      const upload = media.at(-1).body?.output?.upload_url
      assert.ok(upload)
      const response = await fetch(upload, {
        method: "PUT",
        body: mp4,
        headers: { "content-type": "video/mp4" },
        redirect: "error",
      })
      assert.equal(response.status, 200)
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
try {
  const legacy = JSON.parse(fixture.env.APEXO_CONFIG_CONTENT)
  await writeFile(
    join(fixture.directory, "apexo.json"),
    JSON.stringify({
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      media: {
        image_gen_model_override: "configured-generation",
        image_edit_model_override: "configured-edit",
        video_output: {
          type: "s3",
          bucket: "storage",
          endpoint: new URL(legacy.provider.xai.options.baseURL).origin,
          region: "us-east-1",
          key_prefix: "native clips",
          read_write: {
            access_key_id_env: "APEXO_MEDIA_OPTIONS_RW_ID",
            secret_access_key_env: "APEXO_MEDIA_OPTIONS_RW_SECRET",
          },
          read_only: {
            access_key_id_env: "APEXO_MEDIA_OPTIONS_RO_ID",
            secret_access_key_env: "APEXO_MEDIA_OPTIONS_RO_SECRET",
          },
        },
      },
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
    }),
  )
  for (const name of Object.keys(inputs)) {
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
    checks.push(`${name}:canonical-tool-persisted-output-and-continuation`)
  }
  assert.equal(fixture.calls.filter((call) => !call.ancillary).length, 8)
  assert.equal(media.find((call) => call.path.endsWith("/images/generations"))?.body.model, "environment-generation")
  assert.equal(media.find((call) => call.path.endsWith("/images/edits"))?.body.model, "configured-edit")
  const uploads = media.filter((call) => call.method === "PUT")
  const downloads = media.filter((call) => call.method === "GET")
  assert.equal(uploads.length, 2)
  assert.equal(downloads.length, 2)
  assert.ok(uploads.every((call) => call.credential.startsWith("writer/")))
  assert.ok(
    downloads.every((call) => call.credential.startsWith("reader/") && !call.authorization && !call.privateHeader),
  )
  checks.push("independent-model-overrides-and-private-S3-local-download")
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: process.argv[2] ?? "cli",
        checks,
        languageCalls: fixture.calls.length,
        mediaPaths: media.map((call) => call.path),
        output: fixture.output,
      },
      null,
      2,
    ),
  )
} finally {
  await fixture.close()
}
