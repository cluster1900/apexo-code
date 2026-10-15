import { expect, test } from "bun:test"
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { MemorySession } from "@apexo/core/memory-session"
import { MemoryFlush } from "@apexo/core/memory-flush"
import { WorkspaceMemory } from "@apexo/core/workspace-memory"
import { SessionV1 } from "@apexo/core/v1/session"
import { ModelV2 } from "@apexo/core/model"
import { ProviderV2 } from "@apexo/core/provider"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_memory_records")
const captured = Date.UTC(2026, 9, 13, 10, 11)
function user(text: string, synthetic = false, ignored = false): SessionV1.WithParts {
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      agent: "build",
      time: { created: captured },
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
    },
    parts: [{ id: PartID.ascending(), messageID, sessionID, type: "text", text, synthetic, ignored }],
  }
}
const queries = () => [
  user("Explain the session admission design"),
  user("Check cancellation and retry boundaries"),
  user("Verify that the regression tests pass"),
]

test("session metadata skips trivial, synthetic and ignored prompts and counts UTF-8 bytes", () => {
  expect(MemorySession.summarize(sessionID, queries().slice(0, 2), captured)).toBeUndefined()
  expect(MemorySession.summarize(sessionID, [user("hi"), user("ok"), user("bye")], captured)).toBeUndefined()
  expect(
    MemorySession.summarize(
      sessionID,
      [
        user("Long real request with sufficient text to pass the byte limit"),
        user("automatic wake", true),
        user("__auto_continue__"),
        user("discarded text", false, true),
      ],
      captured,
    ),
  ).toBeUndefined()
  const result = MemorySession.summarize(
    sessionID,
    [user("配置数据库连接池"), user("保存用户操作记录"), user("验证自动保存结果")],
    captured,
  )
  expect(result?.content).toContain("3 user")
  expect(result?.content).toContain("2026-10-13 10:11 UTC")
})

test("session metadata contains at most five topics, preserves Unicode and excludes assistant/tool content", () => {
  const messageID = MessageID.ascending()
  const assistant: SessionV1.WithParts = {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      parentID: MessageID.ascending(),
      agent: "build",
      mode: "build",
      path: { cwd: "/private/workspace", root: "/private/workspace" },
      time: { created: captured, completed: captured },
      modelID: ModelV2.ID.make("test"),
      providerID: ProviderV2.ID.make("test"),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    },
    parts: [
      { id: PartID.ascending(), messageID, sessionID, type: "text", text: "ASSISTANT_PRIVATE_CONTENT" },
      {
        id: PartID.ascending(),
        messageID,
        sessionID,
        type: "tool",
        callID: "call_private",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "PRIVATE_COMMAND" },
          output: "PRIVATE_TOOL_OUTPUT",
          title: "secret",
          metadata: {},
          time: { start: captured, end: captured },
        },
      },
    ],
  }
  const record = MemorySession.summarize(
    sessionID,
    [
      user("😀".repeat(110)),
      ...queries(),
      user("fifth topic"),
      user("SIXTH_TOPIC_NOT_SAVED"),
      user("SYNTHETIC_TOPIC", true),
      assistant,
    ],
    captured,
  )!
  expect(record.content).toContain("6 user, 1 assistant, 1 tool results")
  expect(record.content).toContain(`1. ${"😀".repeat(100)}\n`)
  for (const secret of [
    "SIXTH_TOPIC_NOT_SAVED",
    "SYNTHETIC_TOPIC",
    "ASSISTANT_PRIVATE_CONTENT",
    "PRIVATE_COMMAND",
    "PRIVATE_TOOL_OUTPUT",
    "/private/workspace",
  ])
    expect(record.content).not.toContain(secret)
})

test("session log updates atomically without duplicates and older checkpoints cannot replace newer ones", async () => {
  await using home = await tmpdir()
  await using directory = await tmpdir()
  const previous = MemorySession.summarize(sessionID, queries(), captured)!
  const current = MemorySession.summarize(
    sessionID,
    [...queries(), user("Now inspect the final code changes")],
    captured + 1000,
  )!
  const input = { projectID: "shared-project" }
  await MemorySession.save(directory.path, current, home.path, input)
  await Promise.all([
    MemorySession.save(directory.path, previous, home.path, input),
    MemorySession.save(directory.path, current, home.path, input),
  ])
  const target = MemorySession.file(directory.path, current, home.path, input)
  expect(await readFile(target, "utf8")).toBe(current.content)
  expect(await readdir(path.dirname(target))).toHaveLength(1)
  expect(MemorySession.file("/another-clone", current, home.path, input)).toBe(target)
  expect(MemorySession.file(directory.path, { ...current, sessionID: "ses_other" }, home.path, input)).not.toBe(target)
  expect(() => MemorySession.file(directory.path, { ...current, sessionID: "../outside" }, home.path, input)).toThrow()
})

test("automatic logs reject redirected memory directories and preserve the external target", async () => {
  await using home = await tmpdir()
  await using directory = await tmpdir()
  const record = MemorySession.summarize(sessionID, queries(), captured)!
  const root = path.dirname(WorkspaceMemory.file(directory.path, home.path))
  await mkdir(root, { recursive: true })
  await symlink(directory.path, path.join(root, "sessions"), "dir")
  await writeFile(path.join(directory.path, "private.md"), "PRIVATE")
  await expect(MemorySession.save(directory.path, record, home.path)).rejects.toThrow("symbolic links")
  expect(await readdir(directory.path)).toEqual(["private.md"])
})

test("flush response processing follows NO_REPLY variants, Markdown and Unicode character limits", () => {
  for (const text of ["", "NO_REPLY", "**no reply**", "No-Reply", "`noreply`"])
    expect(MemoryFlush.response(text)).toEqual({ status: "empty" })
  expect(MemoryFlush.response("plain text")).toEqual({ status: "rejected" })
  expect(MemoryFlush.response("# Topic\nA verified fact")).toEqual({
    status: "accepted",
    content: "# Topic\nA verified fact",
  })
  expect(MemoryFlush.response(`## Topic\n${"😀".repeat(20)}`, 12)).toEqual({
    status: "accepted",
    content: `## Topic\n${"😀".repeat(3)}`,
  })
  expect(MemoryFlush.response("long preamble\n## Topic", 4)).toEqual({ status: "rejected" })
})

test("flush window drops synthetic and ignored text and retains the latest twenty user messages", () => {
  const messages = Array.from({ length: 30 }, (_, index) => user(`Question ${index}`))
  const window = MemoryFlush.window([...messages, user("synthetic context", true), user("ignored", false, true)])
  expect(window).toHaveLength(20)
  expect(window[0]!.info.id).toBe(messages[10]!.info.id)
  expect(window.at(-1)!.info.id).toBe(messages.at(-1)!.info.id)
})

test("saved session reads reject file and directory symlinks before using previous memory", async () => {
  await using home = await tmpdir()
  await using directory = await tmpdir()
  const record = MemorySession.summarize(sessionID, queries(), captured)!
  expect(await MemorySession.load(directory.path, record, home.path)).toBe("")
  await MemorySession.save(directory.path, record, home.path)
  expect(await MemorySession.load(directory.path, record, home.path)).toBe(record.content)
  const other = { ...record, sessionID: "ses_redirected" }
  const privateFile = path.join(directory.path, "private.md")
  await writeFile(privateFile, "PRIVATE")
  await symlink(privateFile, MemorySession.file(directory.path, other, home.path))
  await expect(MemorySession.load(directory.path, other, home.path)).rejects.toThrow("redirected")
})
