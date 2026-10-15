import { expect, test } from "bun:test"
import { Effect } from "effect"
import { GrokBuildMedia } from "@/tool/grok-build-media"
import { presign } from "@/tool/grok-media-s3"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Tool } from "@/tool/tool"
import { ProviderV2 } from "@apexo/core/provider"
import { ModelV2 } from "@apexo/core/model"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"

const context: Tool.Context = {
  sessionID: SessionID.make("ses_media"),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  metadata: () => Effect.void,
  ask: () => Effect.void,
  messages: [],
}
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"

test("image editing follows official single/multiple image payloads and saves image attachments", async () => {
  await using dir = await tmpdir()
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      calls.push({ path: new URL(request.url).pathname, body: await request.json() })
      return Response.json({ data: [{ b64_json: png }] })
    },
  })
  try {
    await Bun.write(`${dir.path}/input.png`, Buffer.from(png, "base64"))
    const tool = GrokBuildMedia.tools({ key: Effect.succeed("fixture-key"), baseURL: server.url.href }).find(
      (tool) => tool.id === "image_edit",
    )!
    for (const image of [["input.png"], ["input.png", `data:image/png;base64,${png}`]]) {
      const result = await Effect.runPromise(
        tool.execute({ prompt: "make it blue", image }, { ...context, extra: { directory: dir.path } }),
      )
      expect(result.metadata.status).toBe("completed")
      expect(result.metadata.path).toContain("/images/")
      expect(result.attachments?.[0]?.mime).toBe("image/png")
      expect(await Bun.file(String(result.metadata.path)).bytes()).toEqual(Buffer.from(png, "base64"))
    }
    expect(calls[0]?.path).toBe("/images/edits")
    expect(calls[0]?.body.image).toEqual({ url: `data:image/png;base64,${png}` })
    expect(calls[0]?.body.aspect_ratio).toBeUndefined()
    expect(calls[1]?.body.images).toHaveLength(2)
    expect(calls[1]?.body.aspect_ratio).toBe("auto")
    expect(calls[0]?.body.resolution).toBe("1k")
    const invalid = await Effect.runPromise(tool.execute({ prompt: "edit", image: [] }, context))
    expect(invalid.metadata.status).toBe("error")
    expect(calls).toHaveLength(2)
  } finally {
    server.stop(true)
  }
})

test("S3 video output uses signed PUT and GET without forwarding xAI credentials", async () => {
  await using dir = await tmpdir()
  const requests: Request[] = []
  const bodies: Record<string, unknown>[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      requests.push(request)
      if (request.method === "POST") {
        bodies.push(await request.json())
        return Response.json({ request_id: "fixture-video" })
      }
      if (new URL(request.url).pathname === "/videos/fixture-video") return Response.json({ status: "done" })
      return new Response("fixture-mp4", { headers: { "content-type": "video/mp4" } })
    },
  })
  try {
    const outputS3 = {
      bucket: "videos",
      endpoint: server.url.origin,
      region: "us-east-1",
      read_write: { access_key_id: "writer", secret_access_key: "writer-secret" },
      read_only: { access_key_id: "reader", secret_access_key: "reader-secret" },
    }
    const tool = GrokBuildMedia.tools({
      key: Effect.succeed("fixture-api-key"),
      baseURL: server.url.href,
      outputS3,
    }).find((tool) => tool.id === "image_to_video")!
    const result = await Effect.runPromise(
      tool.execute({ image: `data:image/png;base64,${png}` }, { ...context, extra: { directory: dir.path } }),
    )
    expect(result.metadata.status).toBe("completed")
    expect(await Bun.file(String(result.metadata.path)).text()).toBe("fixture-mp4")
    expect(JSON.stringify(bodies[0])).toContain("X-Amz-Credential=writer%2F")
    expect(requests.at(-1)?.url).toContain("X-Amz-Credential=reader%2F")
    expect(requests.at(-1)?.headers.get("authorization")).toBeNull()
    expect(JSON.stringify(result)).not.toContain("secret")
  } finally {
    server.stop(true)
  }
})

test("S3 signatures agree with Bun's independent signer for PUT and GET", () => {
  const config = {
    key_prefix: "grok/videos",
    expires_secs: 3600,
    bucket: "videos",
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    read_write: { access_key_id: "writer", secret_access_key: "secret" },
  }
  for (const method of ["PUT", "GET"] as const) {
    const independent = new URL(
      Bun.S3Client.presign("grok/videos/test.mp4", {
        endpoint: config.endpoint,
        bucket: config.bucket,
        region: config.region,
        accessKeyId: "writer",
        secretAccessKey: "secret",
        expiresIn: 3600,
        method,
      }),
    )
    const timestamp = independent.searchParams.get("X-Amz-Date")!
    const date = new Date(timestamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"))
    const result = presign(config, date, "test.mp4")
    const signed = new URL(method === "PUT" ? result.upload : result.download)
    expect(signed.pathname).toBe(independent.pathname)
    expect(signed.searchParams.get("X-Amz-Signature")).toBe(independent.searchParams.get("X-Amz-Signature"))
  }
})

test("image attachment file URLs decode spaces before permission checks and reading", async () => {
  await using dir = await tmpdir()
  const file = `${dir.path}/blue square.png`
  await Bun.write(file, Buffer.from(png, "base64"))
  const permissions: string[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = await request.json()
      expect(body.image.url).toBe(`data:image/png;base64,${png}`)
      return Response.json({ data: [{ b64_json: png }] })
    },
  })
  try {
    const tool = GrokBuildMedia.tools({ key: Effect.succeed("fixture"), baseURL: server.url.href }).find(
      (tool) => tool.id === "image_edit",
    )!
    const result = await Effect.runPromise(
      tool.execute(
        { prompt: "edit", image: ["[Image #1]"] },
        {
          ...context,
          extra: { directory: dir.path },
          ask: (request) =>
            Effect.sync(() => {
              if (request.permission === "read") permissions.push(...request.patterns)
            }),
          messages: [
            {
              info: {
                id: context.messageID,
                sessionID: context.sessionID,
                role: "user",
                agent: "build",
                time: { created: 1 },
                model: { providerID: ProviderV2.ID.make("xai"), modelID: ModelV2.ID.make("fixture") },
              },
              parts: [
                {
                  id: PartID.ascending(),
                  messageID: context.messageID,
                  sessionID: context.sessionID,
                  type: "file",
                  mime: "image/png",
                  url: pathToFileURL(file).href,
                },
              ],
            },
          ],
        },
      ),
    )
    expect(result.metadata.status).toBe("completed")
    expect(permissions).toEqual([file])
  } finally {
    server.stop(true)
  }
})

test("reference video requires an aspect ratio and rejects empty voice identifiers", async () => {
  const tool = GrokBuildMedia.tools({ key: Effect.succeed("fixture") }).find(
    (tool) => tool.id === "reference_to_video",
  )!
  await expect(Effect.runPromise(tool.execute({ prompt: "speak", voices: ["eve"] }, context))).rejects.toThrow(
    "aspect_ratio",
  )
  const result = await Effect.runPromise(
    tool.execute({ prompt: "speak", voices: [" "], aspect_ratio: "16:9" }, context),
  )
  expect(result.metadata.status).toBe("error")
  expect(result.output).toContain("Voice identifiers must not be empty")
})

test("S3 expiry survives generation and incomplete read-only credentials use the writer", () => {
  const signed = presign({
    bucket: "videos",
    endpoint: "https://s3.example.com",
    region: "us-east-1",
    expires_secs: 1,
    key_prefix: "  grok/videos/  ",
    read_write: { access_key_id: "writer", secret_access_key: "writer-secret" },
    read_only: { access_key_id: "reader", secret_access_key: " " },
  })
  expect(new URL(signed.upload).pathname).toStartWith("/videos/grok/videos/")
  expect(new URL(signed.upload).searchParams.get("X-Amz-Expires")).toBe("480")
  expect(new URL(signed.download).searchParams.get("X-Amz-Credential")).toStartWith("writer/")
})

test("S3 download failure stays an error after a GET URL has been minted", async () => {
  await using dir = await tmpdir()
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method === "POST") {
        await request.json()
        return Response.json({ request_id: "fixture-video" })
      }
      if (new URL(request.url).pathname === "/videos/fixture-video") return Response.json({ status: "done" })
      return new Response("denied", { status: 403 })
    },
  })
  try {
    const tool = GrokBuildMedia.tools({
      key: Effect.succeed("fixture-api-key"),
      baseURL: server.url.href,
      outputS3: {
        bucket: "videos",
        endpoint: server.url.origin,
        region: "us-east-1",
        read_write: { access_key_id: "writer", secret_access_key: "writer-secret" },
      },
    }).find((tool) => tool.id === "image_to_video")!
    const result = await Effect.runPromise(
      tool.execute({ image: `data:image/png;base64,${png}` }, { ...context, extra: { directory: dir.path } }),
    )
    expect(result.metadata.status).toBe("error")
    expect(result.output).toBe("Media download failed with HTTP 403")
    expect(result.attachments).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain("X-Amz")
  } finally {
    server.stop(true)
  }
})
