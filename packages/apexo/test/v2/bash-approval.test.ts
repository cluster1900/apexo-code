import { describe, expect, test } from "bun:test"
import { BashApproval } from "@apexo/core/tool/bash-approval"
import { Wildcard } from "@apexo/core/util/wildcard"

const a = (cmd: string, kind?: BashApproval.ShellKind) => {
  const r = BashApproval.approval(cmd, kind)
  return { resources: [...r.resources], save: [...r.save] }
}
const covered = (cmd: string, saved: readonly string[]) =>
  a(cmd).resources.every((resource) => saved.some((rule) => Wildcard.match(resource, rule)))

describe("BashApproval.approval", () => {
  test("arity prefixes for simple commands", () => {
    expect(a("git status")).toEqual({ resources: ["git status"], save: ["git status *"] })
    expect(a("git log --oneline -5")).toEqual({ resources: ["git log --oneline -5"], save: ["git log *"] })
    expect(a("npm run dev")).toEqual({ resources: ["npm run dev"], save: ["npm run dev *"] })
    expect(a("ls -la src")).toEqual({ resources: ["ls -la src"], save: ["ls *"] })
    expect(a("python3 x.py").save).toEqual(["python3 x.py"])
  })

  test("chains split into per-command resources; setup commands need no grant", () => {
    expect(a("cd packages/app && bun test 2>&1 | tail -20")).toEqual({
      resources: ["bun test", "tail -20"],
      save: ["bun test", "tail *"],
    })
    expect(a("git add -A; git commit -m wip")).toEqual({
      resources: ["git add -A", "git commit -m wip"],
      save: ["git add *", "git commit *"],
    })
  })

  test("a saved prefix covers later invocations but not other programs", () => {
    const saved = a("git status").save
    expect(covered("git status -s", saved)).toBe(true)
    expect(covered("cd x && git status", saved)).toBe(true)
    expect(covered("git statusx", saved)).toBe(false)
    expect(covered("git status && git push", saved)).toBe(false)
  })

  test("dangerous verbs and exec vehicles are pinned to the exact command (Grok Build)", () => {
    expect(a("rm -rf dist").save).toEqual(["rm -rf dist"])
    expect(a("git push origin main").save).toEqual(["git push origin main"])
    expect(a("sudo apt update").save).toEqual(["sudo apt update"])
    expect(a("npx prettier -w .").save).toEqual(["npx prettier -w ."])
    expect(a("/usr/bin/RM.exe x").save).toEqual(["/usr/bin/RM.exe x"])
    expect(a("gh pr view 5").save).toEqual(["gh pr view *"])
    expect(a("gh --version").save).toEqual(["gh --version"])
  })

  test("wrappers and assignments are peeled", () => {
    expect(a("FOO=1 timeout 30 npm test")).toEqual({ resources: ["npm test"], save: ["npm test *"] })
    expect(a("env -i A=b nice -n 5 git diff").save).toEqual(["git diff *"])
  })

  test("opaque scripts fall back to the exact raw script", () => {
    for (const cmd of [
      "echo $(whoami)",
      "echo `id`",
      "ls > out.txt",
      "cat <<EOF\nx\nEOF",
      "(cd a && make)",
      "for f in *; do rm $f; done",
      'echo "$HOME"',
      "grep 'a b' file",
      "echo 'unterminated",
    ])
      expect(a(cmd)).toEqual({ resources: [cmd], save: [cmd] })
    expect(a("cd /tmp")).toEqual({ resources: ["cd /tmp"], save: ["cd /tmp"] })
  })

  test("safe redirects and comments are ignored", () => {
    expect(a("make build >/dev/null 2>&1 # quiet").resources).toEqual(["make build"])
  })

  test("powershell and cmd", () => {
    expect(a("Get-ChildItem -Recurse; git status", "powershell")).toEqual({
      resources: ["get-childitem -Recurse", "git status"],
      save: ["get-childitem *", "git status *"],
    })
    expect(a("Remove-Item -Recurse x", "powershell").save).toEqual(["remove-item -Recurse x"])
    expect(a("Write-Output $env:PATH", "powershell").save).toEqual(["Write-Output $env:PATH"])
    expect(a("dir /b & git status", "cmd").resources).toEqual(["dir /b", "git status"])
    expect(a("echo %PATH%", "cmd").save).toEqual(["echo %PATH%"])
  })
})

describe("BashApproval shell selection", () => {
  test("shellKind", () => {
    expect(BashApproval.shellKind("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell")
    expect(BashApproval.shellKind("/usr/bin/pwsh")).toBe("powershell")
    expect(BashApproval.shellKind("C:\\Windows\\system32\\cmd.exe")).toBe("cmd")
    expect(BashApproval.shellKind("/bin/bash")).toBe("posix")
  })
  test("invocation", () => {
    expect(BashApproval.invocation("pwsh", "ls").args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "ls",
    ])
    expect(BashApproval.invocation("cmd.exe", "dir").args).toEqual(["/d", "/s", "/c", "dir"])
    expect(BashApproval.invocation("/bin/sh", "ls").args).toEqual(["-c", "ls"])
  })
})
