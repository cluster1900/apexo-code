import { expect, test } from "bun:test"
import { mediaMetadata, mediaVideoAttachment } from "./media-output"

const file = (path = "/workspace/.grok/sessions/ses_demo/videos/output #1.mp4") => {
  const result = mediaVideoAttachment({
    name: "image_to_video",
    state: { structured: { path, mime: "video/mp4" } },
    id: "tool",
    sessionID: "ses_demo",
    messageID: "msg_demo",
  })
  if (!result) throw new Error("Missing video projection")
  return result
}

test("media projection retains structured output without adding model content or affecting other tools", () => {
  const state = {
    structured: { path: "/workspace/output.mp4", mime: "video/mp4" },
    content: [{ type: "text", text: "Saved media" }],
  }
  expect(mediaMetadata("image_to_video", state)).toEqual(state.structured)
  expect(mediaMetadata("unrelated", state)).toBeUndefined()
  expect(
    mediaVideoAttachment({ name: "image_gen", state, id: "tool", sessionID: "ses_demo", messageID: "msg_demo" }),
  ).toBeUndefined()
  expect(file().url).toBe("file:///workspace/.grok/sessions/ses_demo/videos/output%20%231.mp4")
  expect(state.content).toEqual([{ type: "text", text: "Saved media" }])
})

test("native preview transport uses real HTTP and native cancellation", async () => {
  const child = Bun.spawn([process.execPath, "run", "test-native/media-reader.ts"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  expect(JSON.parse(stdout).checks).toHaveLength(5)
}, 15000)
