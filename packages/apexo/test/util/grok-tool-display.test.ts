import { describe, expect, test } from "bun:test"
import { canonicalToolInput, canonicalToolName } from "@apexo/core/util/grok-tool-display"

describe("grok tool display mapping (shared by CLI TUI and Desktop)", () => {
  test("maps Grok Build tool names to Apexo views", () => {
    expect(canonicalToolName("search_replace")).toBe("edit")
    expect(canonicalToolName("run_terminal_cmd")).toBe("bash")
    expect(canonicalToolName("read_file")).toBe("read")
    expect(canonicalToolName("todo_write")).toBe("todowrite")
    expect(canonicalToolName("edit")).toBe("edit")
    expect(canonicalToolName("custom_tool")).toBe("custom_tool")
  })

  test("maps search_replace input to the edit view fields", () => {
    expect(
      canonicalToolInput("search_replace", { file_path: "a.ts", old_string: "x", new_string: "y", replace_all: true }),
    ).toMatchObject({ filePath: "a.ts", oldString: "x", newString: "y", replaceAll: true })
  })

  test("keeps native names and existing camelCase fields untouched", () => {
    const input = { filePath: "a.ts", oldString: "x", newString: "y" }
    expect(canonicalToolInput("edit", input)).toBe(input)
    expect(canonicalToolInput("search_replace", { filePath: "b.ts", file_path: "a.ts" }).filePath).toBe("b.ts")
  })

  test("maps read_file, list_dir and terminal inputs", () => {
    expect(canonicalToolInput("read_file", { target_file: "r.ts" }).filePath).toBe("r.ts")
    expect(canonicalToolInput("list_dir", { target_directory: "src" }).path).toBe("src")
    expect(canonicalToolInput("run_terminal_cmd", { command: "ls", block_until_ms: 50 }).timeout).toBe(50)
  })
})
