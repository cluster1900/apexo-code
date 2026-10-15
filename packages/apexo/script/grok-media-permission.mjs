import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { startShellFixture, poll } from "./grok-shell-fixture.mjs"
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC"
const hits = []
const inputs = {
  image_gen: { prompt: "blue square" },
  image_edit: { prompt: "blue square", image: [`data:image/png;base64,${png}`] },
  image_to_video: { image: `data:image/png;base64,${png}` },
  reference_to_video: { prompt: "wave", images: [`data:image/png;base64,${png}`], aspect_ratio: "16:9" },
}
const runtime = await startShellFixture(process.argv[2] ?? "cli", {
  config: { permission: { "*": "allow", edit: { "*": "allow", "*.png": "deny", "*.mp4": "deny" } } },
  async http(request, response) {
    if (!/\/(images|videos)\//.test(request.url)) return false
    for await (const chunk of request) {
    }
    hits.push(request.url)
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify(
        request.url.includes("/images/")
          ? { data: [{ b64_json: png }] }
          : request.method === "POST"
            ? { request_id: "fixture" }
            : { status: "failed" },
      ),
    )
    return true
  },
  next({ text, finished, ancillary }) {
    const name = Object.keys(inputs).find((name) => text.includes(`DENIED_MEDIA_${name}`))
    return !finished && !ancillary && name ? { tool: name, args: inputs[name] } : { content: "DENIED_MEDIA_DONE" }
  },
})
try {
  const checks = []
  for (const name of Object.keys(inputs)) {
    const session = await runtime.api("/session", { title: `DENIED_MEDIA_${name}` })
    await runtime.api(`/session/${session.id}/prompt_async`, {
      model: { providerID: "xai", modelID: "grok-4.7" },
      parts: [{ type: "text", text: `DENIED_MEDIA_${name}` }],
    })
    const tool = await poll(
      async () =>
        (await runtime.api(`/session/${session.id}/message`))
          .flatMap((message) => message.parts)
          .find(
            (part) => part.type === "tool" && part.tool === name && ["completed", "error"].includes(part.state.status),
          ),
      name,
    )
    assert.equal(hits.length, 0, `${name}: extension denial must prevent outbound media work`)
    assert.equal(tool.state.status, "error")
    assert.match(tool.state.error, /permission|denied/i)
    assert.equal(existsSync(join(runtime.directory, ".grok", "sessions", session.id)), false)
    checks.push(`${name}:denied-before-outbound-and-write`)
  }
  console.log(
    JSON.stringify(
      {
        result: "pass",
        runtime: process.argv[2] ?? "cli",
        checks,
        calls: runtime.calls.length,
        mediaCalls: hits.length,
        output: runtime.output,
      },
      null,
      2,
    ),
  )
} finally {
  await runtime.close()
}
