import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ClaudeImport } from "../../src/config/claude-import"

describe("ClaudeImport", () => {
  test("translates Claude rules with deny winning", () => {
    expect(ClaudeImport.translateRule("Bash(git *)")).toEqual({ tool: "bash", pattern: "git *" })
    expect(ClaudeImport.translateRule("Bash(npm run test:*)")).toEqual({ tool: "bash", pattern: "npm run test *" })
    expect(ClaudeImport.translateRule("Read")).toEqual({ tool: "read", pattern: "*" })
    expect(ClaudeImport.translateRule("mcp__linear__get_issue")).toEqual({ tool: "linear_get_issue", pattern: "*" })
    expect(ClaudeImport.translateRule("mcp__linear")).toEqual({ tool: "linear_*", pattern: "*" })
    expect("skip" in ClaudeImport.translateRule("Agent(model:opus)")).toBe(true)
    expect("skip" in ClaudeImport.translateRule("Frobnicate")).toBe(true)
    const plan = ClaudeImport.plan({
      settings: [
        {
          file: "settings.json",
          data: {
            permissions: { allow: ["Bash(rm *)", "Read"], deny: ["Bash(rm *)"], defaultMode: "bypassPermissions" },
            env: { FOO: "1" },
            hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }] },
          },
        },
      ],
      claudeJson: {
        file: ".claude.json",
        data: { mcpServers: { local: { command: "npx", args: ["srv"], env: { K: "v" } }, web: { url: "https://x" } } },
      },
      rules: { dir: "/h/.claude/rules", files: ["a.md"] },
    })
    expect(plan.permission.bash).toEqual({ "rm *": "deny" })
    expect(plan.permissionMode).toBe("always-approve")
    expect(plan.mcp.local).toEqual({ type: "local", command: ["npx", "srv"], environment: { K: "v" } })
    expect(plan.mcp.web).toEqual({ type: "remote", url: "https://x" })
    expect(ClaudeImport.configPatch(plan, ["env", "paths"])).toEqual({
      env: { FOO: "1" },
      instructions: ["/h/.claude/rules/*.md"],
    })
  })

  test("loads ~/.claude and writes hooks into the Grok hooks directory", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "claude-import-"))
    await fs.mkdir(path.join(home, ".claude", "rules"), { recursive: true })
    await fs.writeFile(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }),
    )
    await fs.writeFile(path.join(home, ".claude", "rules", "style.md"), "# style")
    const plan = await ClaudeImport.load(home)
    const preview = ClaudeImport.preview(plan)
    expect(preview.found).toBe(true)
    expect(preview.sections.find((section) => section.id === "hooks")?.count).toBe(1)
    const previous = process.env.GROK_HOME
    delete process.env.GROK_HOME
    const file = await ClaudeImport.writeHooks(home, plan)
    if (previous !== undefined) process.env.GROK_HOME = previous
    expect(file).toBe(path.join(home, ".grok", "hooks", "claude-import.json"))
    expect(JSON.parse(await fs.readFile(file!, "utf8")).hooks.Stop).toHaveLength(1)
  })
})
