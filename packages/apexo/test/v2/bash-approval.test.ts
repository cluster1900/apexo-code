import { describe, expect, test } from "bun:test"
import { BashApproval } from "@apexo/core/tool/bash-approval"
import { ShellPath } from "@apexo/core/tool/shell-path"
import { Wildcard } from "@apexo/core/util/wildcard"

const a = (cmd: string, kind?: BashApproval.ShellKind) => {
  const r = BashApproval.approval(cmd, kind)
  return { resources: [...r.resources], save: [...r.save] }
}
const covered = (cmd: string, saved: readonly string[]) =>
  a(cmd).resources.every((resource) => saved.some((rule) => Wildcard.match(resource, rule)))

describe("Grok Build default scope (grants.rs base_scope)", () => {
  test("safe-listed commands narrow to the safe prefix; others take verb + subcommand + flags", () => {
    expect(a("git status")).toEqual({ resources: ["git status"], save: ["git status *"] })
    expect(a("git log --oneline -5").save).toEqual(["git log *"])
    expect(a("ls -la src").save).toEqual(["ls *"])
    expect(a("kubectl get pods -A").save).toEqual(["kubectl get *"])
    expect(a("npm run dev").save).toEqual(["npm run *"])
    expect(a("git add -A").save).toEqual(["git add -A *"])
    expect(a("cargo build --release --locked").save).toEqual(["cargo build --release --locked *"])
  })
  test("unsafe flags lose the safe narrowing", () => {
    expect(a("rg --pre cat foo").save).toEqual(["rg --pre *"])
    expect(a("git log --output=x").save).toEqual(["git log --output=x *"])
    expect(a("ps eww").save).toEqual(["ps eww *"])
    expect(a("kubectl get pods --context prod").save).toEqual(["kubectl get *"])
  })
  test("pinned commands are exact; gh scopes to group + action", () => {
    expect(a("rm -rf dist").save).toEqual(["rm -rf dist"])
    expect(a("git push origin main").save).toEqual(["git push origin main"])
    expect(a("sudo apt update").save).toEqual(["sudo apt update"])
    expect(a("sed -n 1p f").save).toEqual(["sed -n 1p f"])
    expect(a("python3 x.py").save).toEqual(["python3 x.py"])
    expect(a("/usr/bin/RM.exe x").save).toEqual(["/usr/bin/RM.exe x"])
    expect(a("gh pr view 5").save).toEqual(["gh pr view *"])
  })
})

describe("chains, wrappers, opaque scripts", () => {
  test("per-command resources; setup commands need no grant", () => {
    expect(a("cd packages/app && bun test 2>&1 | tail -20")).toEqual({
      resources: ["bun test", "tail -20"],
      save: ["bun test", "tail *"],
    })
    expect(a("FOO=1 timeout 30 npm test")).toEqual({ resources: ["npm test"], save: ["npm test *"] })
    expect(a("env -i A=b nice -n 5 git diff").save).toEqual(["git diff *"])
  })
  test("a saved prefix covers later invocations but not other programs", () => {
    const saved = a("git status").save
    expect(covered("git status -s", saved)).toBe(true)
    expect(covered("cd x && git status", saved)).toBe(true)
    expect(covered("git statusx", saved)).toBe(false)
    expect(covered("git status && git push", saved)).toBe(false)
  })
  test("space-bearing words stay resources but never enter a grant key", () => {
    expect(a("grep 'a b' file")).toEqual({ resources: ["grep a b file"], save: ["grep *"] })
    expect(a('git commit -m "wip x"').save).toEqual(["git commit -m *"])
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
      "sleep 5 & echo started",
      "echo 'unterminated",
    ])
      expect(a(cmd)).toEqual({ resources: [cmd], save: [cmd] })
  })
  test("powershell and cmd", () => {
    expect(a("Get-ChildItem -Recurse; git status", "powershell")).toEqual({
      resources: ["get-childitem -Recurse", "git status"],
      save: ["get-childitem -Recurse *", "git status *"],
    })
    expect(a("Remove-Item -Recurse x", "powershell").save).toEqual(["remove-item -Recurse x"])
    expect(a("Write-Output $env:PATH", "powershell").save).toEqual(["Write-Output $env:PATH"])
    expect(a("dir /b & git status", "cmd").resources).toEqual(["dir /b", "git status"])
  })
})

describe("scope picker", () => {
  test("choices run from the minimum scope to the full command; default is Grok's", () => {
    const r = BashApproval.approval("git log --oneline -5")
    expect(r.choices?.map((c) => c.label)).toEqual([
      "git *",
      "git log *",
      "git log --oneline *",
      "git log --oneline -5 *",
    ])
    expect(r.defaultChoice).toBe(1)
    expect(r.save).toEqual(r.choices![1]!.save)
    expect(BashApproval.approval("gh pr view 5").choices?.map((c) => c.label)).toEqual([
      "gh pr view *",
      "gh pr view 5 *",
    ])
    expect(BashApproval.approval("rm -rf x").choices?.length).toBe(1)
  })
  test("other chained commands keep their default in every choice", () => {
    const r = BashApproval.approval("npm run build && git status")
    expect(r.choices?.map((c) => c.save)).toEqual([
      ["npm *", "git status *"],
      ["npm run *", "git status *"],
      ["npm run build *", "git status *"],
    ])
  })
  test("only offered save sets are accepted", () => {
    const meta = BashApproval.metadata(BashApproval.approval("git log --oneline -5"))
    expect(BashApproval.offered(meta, ["git *"])).toBe(true)
    expect(BashApproval.offered(meta, ["*"])).toBe(false)
    expect(BashApproval.offered(meta, ["git *", "rm *"])).toBe(false)
    expect(BashApproval.offered({}, ["git *"])).toBe(false)
  })
})

describe("tree-sitter analysis (shared parser)", () => {
  test("decomposes word-only chains and refuses everything else", async () => {
    expect([...(await BashApproval.analyze("cd a && make build >/dev/null 2>&1 # q")).resources]).toEqual([
      "make build",
    ])
    for (const cmd of ["echo $(id)", "a & b", "ls > out", 'echo "$HOME"', "(cd a)", "cat <<EOF\nx\nEOF"])
      expect([...(await BashApproval.analyze(cmd)).resources]).toEqual([cmd])
    expect([...(await BashApproval.analyze('git commit -m "wip x"')).save]).toEqual(["git commit -m *"])
  })
})

describe("ShellPath", () => {
  const base = { cwd: "/repo", home: "/home/u", shell: "/bin/sh", env: { TMPDIR: "/t" }, platform: "linux" as const }
  test("posix", () => {
    expect(ShellPath.paths("cat ~/x /etc/hosts ./rel $HOME/y", { ...base, kind: "posix" })).toEqual([
      "/home/u/x",
      "/etc/hosts",
    ])
  })
  const win = {
    cwd: "C:\\repo",
    home: "C:\\Users\\u",
    shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    env: { USERPROFILE: "C:\\Users\\u", Temp: "C:\\Temp" },
    platform: "win32" as const,
  }
  test("powershell env, provider and home expansion", () => {
    expect(
      ShellPath.paths(
        "Get-Content $env:TEMP\\a.txt ${env:USERPROFILE}\\b FileSystem::D:\\c Microsoft.PowerShell.Core\\FileSystem::E:\\d HKLM:\\Software ~\\e $PSHOME\\f $other\\g",
        { ...win, kind: "powershell" },
      ),
    ).toEqual([
      "C:\\Temp\\a.txt",
      "C:\\Users\\u\\b",
      "D:\\c",
      "E:\\d",
      "C:\\Users\\u\\e",
      "C:\\Program Files\\PowerShell\\7\\f",
    ])
  })
  test("cmd %VAR% and switches", () => {
    expect(ShellPath.paths("type %USERPROFILE%\\x.txt /s D:\\y %MISSING%\\z", { ...win, kind: "cmd" })).toEqual([
      "C:\\Users\\u\\x.txt",
      "D:\\y",
    ])
  })
  test("MSYS and Cygwin drive paths on Windows", () => {
    expect(ShellPath.windowsPath("/c/Users/u")).toBe("C:\\Users\\u")
    expect(ShellPath.windowsPath("/cygdrive/d/x/y")).toBe("D:\\x\\y")
    expect(ShellPath.paths("cat /c/Users/u/a /cygdrive/d/b", { ...win, kind: "posix" })).toEqual([
      "C:\\Users\\u\\a",
      "D:\\b",
    ])
  })
})

describe("BashApproval shell selection", () => {
  test("shellKind and invocation", () => {
    expect(BashApproval.shellKind("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell")
    expect(BashApproval.shellKind("/usr/bin/pwsh")).toBe("powershell")
    expect(BashApproval.shellKind("C:\\Windows\\system32\\cmd.exe")).toBe("cmd")
    expect(BashApproval.shellKind("/bin/bash")).toBe("posix")
    expect(BashApproval.invocation("pwsh", "ls").args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "ls",
    ])
    expect(BashApproval.invocation("cmd.exe", "dir").args).toEqual(["/d", "/s", "/c", "dir"])
  })
})
