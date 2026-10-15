// Real isolated CLI/Electron backend, deterministic xAI media protocol fixtures.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
const calls = []
const storageCalls = []
const storage = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    storageCalls.push({ url: request.url, authorization: request.headers.get("authorization") })
    return new Response("fixture-mp4")
  },
})
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  config: {
    grok_media: {
      zdr_video_output_s3: {
        bucket: "fixture",
        endpoint: storage.url.origin,
        region: "us-east-1",
        read_write: { access_key_id: "writer", secret_access_key: "fixture-secret" },
        read_only: { access_key_id: "reader", secret_access_key: "fixture-read-secret" },
      },
    },
  },
  async http(request, response) {
    if (!/\/(images|videos)\//.test(request.url)) return false
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    calls.push({ path: request.url, body })
    response.setHeader("content-type", "application/json")
    if (request.url.includes("/images/")) response.end(JSON.stringify({ data: [{ b64_json: png }] }))
    else if (request.method === "POST") response.end(JSON.stringify({ request_id: "media-fixture" }))
    else
      response.end(
        JSON.stringify({ status: "done", video: { url: `http://${request.headers.host}/videos/result.mp4` } }),
      )
    return true
  },
  next({ text, finished, ancillary }) {
    if (ancillary || finished) return { content: "MEDIA_DONE" }
    if (text.includes("MEDIA_EDIT"))
      return { tool: "image_edit", args: { prompt: "make blue", image: [`data:image/png;base64,${png}`] } }
    if (text.includes("MEDIA_IMAGE")) return { tool: "image_gen", args: { prompt: "blue square" } }
    if (text.includes("MEDIA_REFERENCE"))
      return {
        tool: "reference_to_video",
        args: {
          prompt: "rotate reference",
          aspect_ratio: "16:9",
          images: [`data:image/png;base64,${png}`],
          first_frame: `data:image/png;base64,${png}`,
          keyframes: [{ image: `data:image/png;base64,${png}`, timestamp_s: 3 }],
          duration: 6,
        },
      }
    if (text.includes("MEDIA_VIDEO"))
      return { tool: "image_to_video", args: { image: `data:image/png;base64,${png}`, prompt: "rotate" } }
    return { content: "MEDIA_DONE" }
  },
})
try {
  const commands = await runtime.api("/command")
  assert.ok(commands.some((command) => command.name === "imagine"))
  assert.ok(commands.some((command) => command.name === "imagine-video"))
  for (const [marker, name] of [
    ["MEDIA_IMAGE", "image_gen"],
    ["MEDIA_EDIT", "image_edit"],
    ["MEDIA_VIDEO", "image_to_video"],
    ["MEDIA_REFERENCE", "reference_to_video"],
  ]) {
    const session = await runtime.api("/session", { title: marker })
    if (name === "image_edit" || name === "reference_to_video")
      await runtime.api(`/session/${session.id}/prompt_async`, {
        model: { providerID: "xai", modelID: "grok-4.7" },
        parts: [{ type: "text", text: marker }],
      })
    else
      await runtime.api(`/session/${session.id}/command`, {
        model: "xai/grok-4.7",
        command: name === "image_gen" ? "imagine" : "imagine-video",
        arguments: marker,
      })
    const tool = await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`))
          .flatMap((message) => message.parts)
          .find((part) => part.type === "tool" && part.tool === name && part.state.status === "completed"),
      name,
    )
    assert.equal(tool.state.metadata.status, "completed", tool.state.output)
    assert.ok((await readFile(tool.state.metadata.path)).length)
    assert.ok(tool.state.attachments?.length, "Tool preview attachment missing")
  }
  assert.ok(calls.some((call) => call.path === "/v1/images/edits" && call.body.image))
  assert.ok(
    calls
      .find((call) => call.path === "/v1/videos/generations")
      .body.output.upload_url.includes("X-Amz-Credential=writer"),
  )
  assert.equal(storageCalls.length, 2)
  assert.ok(storageCalls[0].url.includes("X-Amz-Credential=reader"))
  assert.equal(storageCalls[0].authorization, null)
  console.log(
    JSON.stringify({
      result: "pass",
      runtime: process.argv[2] ?? "cli",
      scenarios: [
        "image_gen",
        "image_edit",
        "image_to_video",
        "reference_to_video",
        "imagine execution",
        "imagine-video execution",
        "S3 output with separate GET credentials",
      ],
      calls: calls.map((call) => call.path),
    }),
  )
} finally {
  await runtime.close()
  storage.stop(true)
}
