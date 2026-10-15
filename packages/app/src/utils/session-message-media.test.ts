import { expect, test } from "bun:test"
import { normalizeSessionMessages } from "./session-message"

const mention = { start: 0, end: 10, text: "@image.png" }
const base = { type: "user" as const, id: "msg_media", time: { created: 1 }, text: "Edit image" }

test("native image prompt attachments render current URI and optional mention without source assumptions", () => {
  const result = normalizeSessionMessages("ses_media", [
    {
      ...base,
      files: [
        { uri: "data:image/png;base64,aGVsbG8=", mime: "image/png" },
        { uri: "file:///workspace/image.png", mime: "image/png", name: "image.png", source: mention },
      ],
      agents: [{ name: "review", source: { ...mention, text: "@review" } }],
    },
  ])
  expect(result.parts.get(base.id)?.slice(1)).toEqual([
    {
      id: "msg_media:file:0",
      sessionID: "ses_media",
      messageID: base.id,
      type: "file",
      mime: "image/png",
      filename: undefined,
      url: "data:image/png;base64,aGVsbG8=",
      source: undefined,
    },
    {
      id: "msg_media:file:1",
      sessionID: "ses_media",
      messageID: base.id,
      type: "file",
      mime: "image/png",
      filename: "image.png",
      url: "file:///workspace/image.png",
      source: { type: "file", text: { value: mention.text, start: 0, end: 10 }, path: "image.png" },
    },
    {
      id: "msg_media:agent:0",
      sessionID: "ses_media",
      messageID: base.id,
      type: "agent",
      name: "review",
      source: { value: "@review", start: 0, end: 10 },
    },
  ])
})

test("vendored attachment facade retains inline, URI and mention projection", () => {
  const result = normalizeSessionMessages("ses_media", [
    {
      ...base,
      files: [
        { data: "aGVsbG8=", mime: "image/png", source: { type: "inline" } },
        { data: "aGVsbG8=", mime: "image/png", source: { type: "uri", uri: "file:///workspace/image.png" }, mention },
      ],
      agents: [{ name: "review", mention: { ...mention, text: "@review" } }],
    },
  ])
  expect(result.parts.get(base.id)?.slice(1)).toMatchObject([
    { url: "data:image/png;base64,aGVsbG8=" },
    { url: "file:///workspace/image.png", source: { path: "image.png", text: { value: "@image.png" } } },
    { source: { value: "@review", start: 0, end: 10 } },
  ])
})
