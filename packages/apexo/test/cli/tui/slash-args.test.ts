import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { copyResponse, resolveModelArgs, turnResponses, writeNewFile } from "@apexo/tui/util/slash-args"
import { builtinSlashTarget } from "@apexo/tui/prompt/slash-guard"
import { tmpdir } from "../../fixture/fixture"

describe("turnResponses", () => {
  test("keeps each turn's last assistant message with text, oldest first", () => {
    expect(
      turnResponses([
        { role: "user", text: "first" },
        { role: "assistant", text: "Looking at the files" },
        { role: "assistant", text: "" },
        { role: "assistant", text: "## Answer one" },
        { role: "user", text: "second" },
        { role: "assistant", text: "  Answer two\n" },
        { role: "user", text: "third (no reply yet)" },
      ]),
    ).toEqual(["## Answer one", "Answer two"])
  })
})

describe("copyResponse", () => {
  const responses = ["older reply", "latest **markdown** reply"]

  test("copies the latest response by default and the Nth latest with a number", async () => {
    await using dir = await tmpdir()
    const copied: string[] = []
    const write = async (text: string) => {
      copied.push(text)
    }
    const backup = path.join(dir.path, "backup", "last-copy.txt")
    expect(await copyResponse({ responses, args: "", cwd: dir.path, write, backup })).toEqual({
      ok: true,
      message: "Copied!",
    })
    expect(await copyResponse({ responses, args: "2", cwd: dir.path, write, backup })).toEqual({
      ok: true,
      message: "Copied!",
    })
    expect(copied).toEqual(["latest **markdown** reply", "older reply"])
    expect(await readFile(backup, "utf8")).toBe("older reply")
  })

  test("writes a new file and refuses an existing one, leaving it unchanged", async () => {
    await using dir = await tmpdir()
    const backup = path.join(dir.path, "last-copy.txt")
    const created = await copyResponse({ responses, args: "2 out/reply.md", cwd: dir.path, backup })
    expect(created).toEqual({ ok: true, message: `Copied response to ${path.join(dir.path, "out", "reply.md")}` })
    expect(await readFile(path.join(dir.path, "out", "reply.md"), "utf8")).toBe("older reply")

    await writeFile(path.join(dir.path, "taken.txt"), "keep me")
    const refused = await copyResponse({ responses, args: "taken.txt", cwd: dir.path, backup })
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain("already exists; nothing was written")
    expect(await readFile(path.join(dir.path, "taken.txt"), "utf8")).toBe("keep me")
    expect(await readFile(backup, "utf8")).toBe("older reply")
  })

  test("reports missing responses and bad numbers without copying", async () => {
    await using dir = await tmpdir()
    const backup = path.join(dir.path, "last-copy.txt")
    expect(await copyResponse({ responses: [], args: "", cwd: dir.path, backup })).toEqual({
      ok: false,
      message: "No assistant response to copy yet",
    })
    expect(await copyResponse({ responses, args: "3", cwd: dir.path, backup })).toEqual({
      ok: false,
      message: "Only 2 responses to copy in this session",
    })
    expect((await copyResponse({ responses, args: "0", cwd: dir.path, backup })).ok).toBe(false)
  })

  test("falls back to the backup file when no clipboard is available", async () => {
    await using dir = await tmpdir()
    const backup = path.join(dir.path, "last-copy.txt")
    expect(await copyResponse({ responses, args: "", cwd: dir.path, backup })).toEqual({
      ok: true,
      message: `Clipboard unavailable; the response was saved to ${backup}`,
    })
    expect(await readFile(backup, "utf8")).toBe("latest **markdown** reply")
  })
})

test("writeNewFile refuses a taken name", async () => {
  await using dir = await tmpdir()
  expect((await writeNewFile("session.md", "one", dir.path)).ok).toBe(true)
  const again = await writeNewFile("session.md", "two", dir.path)
  expect(again.ok).toBe(false)
  expect(await readFile(path.join(dir.path, "session.md"), "utf8")).toBe("one")
})

describe("resolveModelArgs", () => {
  const providers: Parameters<typeof resolveModelArgs>[1] = [
    {
      id: "openai",
      models: {
        "gpt-5": { name: "GPT-5", variants: { low: {}, high: {} } },
        shared: { name: "Shared" },
      },
    },
    { id: "local", models: { shared: { name: "Shared" }, old: { name: "Old", status: "deprecated" } } },
  ]

  test("matches ID, display name or provider/model ignoring case, with an optional effort", () => {
    expect(resolveModelArgs("gpt-5", providers)).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(resolveModelArgs("gpt-5 HIGH", providers)).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
      effort: "high",
    })
    expect(resolveModelArgs("local/SHARED", providers)).toEqual({ providerID: "local", modelID: "shared" })
  })

  test("prefers the current provider for duplicates and reports ambiguity or no match", () => {
    expect(resolveModelArgs("shared", providers, "local")).toEqual({ providerID: "local", modelID: "shared" })
    expect(resolveModelArgs("shared", providers)).toEqual({
      error: '"shared" matches several models: openai/shared, local/shared',
    })
    expect(resolveModelArgs("old", providers)).toEqual({ error: 'No model matches "old"' })
    expect(resolveModelArgs("gpt-5 turbo", providers)).toEqual({
      error: 'Effort "turbo" is not available for gpt-5. Choose one of: low, high',
    })
  })
})

describe("builtinSlashTarget", () => {
  const slashes = [
    { display: "/compact", aliases: ["/summarize"] },
    { display: "/resume", aliases: ["/continue"] },
    { display: "/goal" },
  ]
  const target = (text: string, extra: Partial<Parameters<typeof builtinSlashTarget>[0]> = {}) =>
    builtinSlashTarget({ text, slashes, serverCommands: [], native: false, session: true, ...extra })

  test("runs palette built-ins typed with arguments or a trailing space", () => {
    expect(target("/compact now please")).toMatchObject({ type: "run", name: "compact", args: "now please" })
    expect(target("/summarize ")).toMatchObject({ type: "run", name: "summarize", args: "" })
  })

  test("leaves server commands, downstream handlers and ordinary text alone", () => {
    expect(target("/compact x", { serverCommands: [{ name: "compact" }] })).toBeUndefined()
    expect(target("/goal ship it")).toBeUndefined()
    expect(target("/review main")).toBeUndefined()
    expect(target("please /compact")).toBeUndefined()
    expect(target("/feedback", { slashes: [{ display: "/feedback" }] })).toBeUndefined()
  })

  test("session-only built-ins on the home screen get a notice", () => {
    expect(target("/rename New title", { slashes: [], session: false })).toEqual({
      type: "session-only",
      name: "rename",
    })
  })
})
