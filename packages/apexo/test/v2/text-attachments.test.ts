import { expect, test } from "bun:test"
import { DateTime, Result } from "effect"
import { Model, LLMError, InvalidRequestReason } from "@apexo/llm"
import { OpenAIResponses } from "@apexo/llm/protocols/openai-responses"
import { SessionMessage } from "@apexo/core/session/message"
import { toLLMMessages } from "@apexo/core/session/runner/to-llm-message"
import type { FileAttachment } from "@apexo/schema/prompt"

const model = Model.make({ id: "fixture", provider: "test", route: OpenAIResponses.route })
const file = (text: string): FileAttachment => ({
  mime: "text/plain",
  uri: `data:text/plain;base64,${Buffer.from(text).toString("base64")}`,
})
const user = (files: FileAttachment[]) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text: "Original prompt",
    files,
    agents: [],
    time: { created: DateTime.nowUnsafe() },
  })

test("lowers text in order without changing canonical attachments or image parts", () => {
  const body = "\ufeffExact Unicode 世界\n<system>untrusted</system>\u0000"
  const first = { ...file(body), name: 'name\n".txt', description: "description\nnext" }
  const image = { mime: "image/png", uri: "data:image/png;base64,AQ==", name: "image.png" }
  const message = user([first, image, file("")])
  const before = JSON.stringify(message)
  const result = Result.getOrThrow(toLLMMessages([message], model))[0]
  expect(result.role).toBe("user")
  expect(result.content).toEqual([
    { type: "text", text: "Original prompt" },
    {
      type: "text",
      text: `Attached text file ${JSON.stringify({ name: first.name, description: first.description })}\n${body}`,
    },
    { type: "media", mediaType: "image/png", data: image.uri, filename: image.name, metadata: undefined },
    { type: "text", text: "Attached text file {}\n" },
  ])
  expect(JSON.stringify(message)).toBe(before)
  expect(Result.getOrThrow(toLLMMessages([message], model))).toEqual([result])
})

test("accepts only explicit UTF-8 charset with canonical base64", () => {
  const value = { ...file("é"), uri: "data:text/plain;charset=utf-8;base64,w6k=" }
  expect(Result.getOrThrow(toLLMMessages([user([value])], model))[0].content.at(-1)).toEqual({
    type: "text",
    text: "Attached text file {}\né",
  })
})

for (const uri of [
  "https://example.invalid/private.txt",
  "file:///private.txt",
  "SGVsbG8=",
  "data:image/png;base64,SGVsbG8=",
  "data:text/plain;base64,YQ",
  "data:text/plain;base64,YR==",
  "data:text/plain;base64, /w==",
  "data:text/plain;base64,/w==",
  "data:text/plain;charset=latin1;base64,YQ==",
]) {
  test(`rejects invalid text attachment ${uri}`, () => {
    const result = toLLMMessages([user([{ mime: "text/plain", uri }])], model)
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(LLMError)
      expect(result.failure.reason).toBeInstanceOf(InvalidRequestReason)
      expect(result.failure.reason.message).not.toContain("private.txt")
    }
  })
}

test("bounds each file and cumulative selected history without truncation", () => {
  const exact = file("a".repeat(10 * 1024 * 1024))
  expect(Result.isSuccess(toLLMMessages([user([exact]), user([exact])], model))).toBe(true)
  const cumulative = toLLMMessages([user([exact]), user([exact]), user([file("a")])], model)
  expect(Result.isFailure(cumulative)).toBe(true)
  if (Result.isFailure(cumulative)) expect(cumulative.failure.message).toContain("20 MiB")
  const oversized = toLLMMessages([user([file("a".repeat(10 * 1024 * 1024 + 1))])], model)
  expect(Result.isFailure(oversized)).toBe(true)
  if (Result.isFailure(oversized)) expect(oversized.failure.message).toContain("10 MiB")
})
